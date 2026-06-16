# Spec: Cost Telemetry & Spend Cross-Reference

**Status:** Draft  
**Date:** 2026-06-15  
**Scope:** Extend token telemetry to capture cache token counts, compute per-turn cost, and cross-reference against Anthropic Console daily/monthly spend.

---

## Problem

The `turns` table stores `input_tokens` and `output_tokens` per turn, which is enough for a rough spend estimate. However:

1. **Cache tokens are invisible.** `cache_read_input_tokens` and `cache_creation_input_tokens` exist in the `Turn` TypeScript type as optional fields but are never written to the DB. Cache reads are 10× cheaper than uncached input, so ignoring them causes the estimate to overcount spend — sometimes significantly in long sessions.

2. **No cost column.** There is nowhere in the schema to store or aggregate cost, so spend queries require joining with a hardcoded rate table at query time. When pricing changes, historical rows are re-priced incorrectly.

3. **No daily/monthly rollup.** Without a cost column or a model-tagged rate table, producing a "spend this week" number requires multiple query steps that don't exist yet.

4. **No Anthropic Console cross-reference.** The Console `/usage` endpoint (accessible via `claude /usage` in a terminal) returns daily spend and token breakdowns per model. There is currently no path to compare that against what the local DB records.

---

## Goals

1. Persist cache token counts so cost can be calculated accurately.
2. Store a computed `cost_usd` on each turn (snapshot pricing at ingest time).
3. Provide a model-tagged pricing table in code so rates are in one place.
4. Add a daily spend rollup query that can be compared against Console output.
5. Add a `cost_usd` column to the sessions aggregate view.

---

## Non-goals

- Live sync with Anthropic Console (polling, auth, API keys for billing).
- Support for batch API pricing.
- Multi-currency support.

---

## Pricing Reference (claude-sonnet-4-6, 2026-06-15)

| Token type                          | $/1M tokens |
|-------------------------------------|-------------|
| Input (uncached)                    | $3.00       |
| Output                              | $15.00      |
| Cache write — 5-min TTL             | $3.75       |
| Cache write — 1-hr TTL              | $6.00       |
| Cache read                          | $0.30       |

Cache write TTL is not distinguishable from the API `usage` object — only one `cache_creation_input_tokens` field is returned. Use the 5-min TTL rate ($3.75) as the conservative default; it will slightly undercount cost if 1-hr TTL blocks are used.

---

## Schema Changes

### `turns` table — add three columns

```sql
ALTER TABLE turns ADD COLUMN cache_read_tokens    INTEGER NOT NULL DEFAULT 0;
ALTER TABLE turns ADD COLUMN cache_creation_tokens INTEGER NOT NULL DEFAULT 0;
ALTER TABLE turns ADD COLUMN cost_usd             REAL    NOT NULL DEFAULT 0;
```

**Migration strategy:** Add via `CREATE TABLE IF NOT EXISTS` replacement in `migrate()` using SQLite's `ALTER TABLE … ADD COLUMN` — safe for existing rows (defaults fill in as 0 / 0 / 0). Existing rows will show `cost_usd = 0` until re-ingested.

### `model_pricing` table — new (in-code constant, not a DB table)

Keep pricing as a typed constant in `packages/core/src/pricing.ts` rather than a DB table. This avoids migration complexity while keeping rates in one place:

```ts
export interface ModelPricing {
  inputPerM: number;
  outputPerM: number;
  cacheReadPerM: number;
  cacheWritePerM: number;  // uses 5-min TTL rate
}

export const MODEL_PRICING: Record<string, ModelPricing> = {
  "claude-sonnet-4-6": {
    inputPerM: 3.00,
    outputPerM: 15.00,
    cacheReadPerM: 0.30,
    cacheWritePerM: 3.75,
  },
  "claude-haiku-4-5-20251001": {
    inputPerM: 0.80,
    outputPerM: 4.00,
    cacheReadPerM: 0.08,
    cacheWritePerM: 1.00,
  },
  // extend as new models are added
};

export function computeCostUsd(
  pricing: ModelPricing,
  inputTokens: number,
  outputTokens: number,
  cacheReadTokens: number,
  cacheCreationTokens: number,
): number {
  return (
    (inputTokens * pricing.inputPerM +
     outputTokens * pricing.outputPerM +
     cacheReadTokens * pricing.cacheReadPerM +
     cacheCreationTokens * pricing.cacheWritePerM) / 1_000_000
  );
}
```

---

## Code Changes

### 1. `packages/core/src/db.ts` — `migrate()`

Add the two `ALTER TABLE` statements (idempotent via `ALTER TABLE … ADD COLUMN IF NOT EXISTS` — not supported in SQLite; use try/catch pattern or check `PRAGMA table_info(turns)`).

```ts
// After the turns CREATE TABLE IF NOT EXISTS block:
for (const col of [
  "ALTER TABLE turns ADD COLUMN cache_read_tokens     INTEGER NOT NULL DEFAULT 0",
  "ALTER TABLE turns ADD COLUMN cache_creation_tokens INTEGER NOT NULL DEFAULT 0",
  "ALTER TABLE turns ADD COLUMN cost_usd              REAL    NOT NULL DEFAULT 0",
]) {
  try { db.run(col); } catch { /* column already exists */ }
}
```

### 2. `packages/core/src/db.ts` — `insertTurn()`

Extend the INSERT to include the three new columns. Map from the `Turn` type fields:

```ts
// Additional bindings:
$cacheReadTokens: t.cacheReadTokens ?? 0,
$cacheCreationTokens: t.cacheCreationTokens ?? 0,
$costUsd: t.costUsd ?? 0,
```

### 3. `packages/core/src/types.ts` — `Turn`

Promote `cacheReadTokens` and `cacheCreationTokens` from optional to required with a default of 0, and add `costUsd`:

```ts
cacheReadTokens: number;       // was optional, now required (default 0)
cacheCreationTokens: number;   // was optional, now required (default 0)
costUsd: number;               // new: computed at ingest time
```

### 4. `packages/core/src/ingest/` — turn construction

At the point where a `Turn` object is built from the JSONL `usage` block, populate the cache fields and compute cost:

```ts
import { MODEL_PRICING, computeCostUsd } from "../pricing.js";

const pricing = MODEL_PRICING[model] ?? MODEL_PRICING["claude-sonnet-4-6"];
const cacheReadTokens = usage.cache_read_input_tokens ?? 0;
const cacheCreationTokens = usage.cache_creation_input_tokens ?? 0;

const turn: Turn = {
  // ... existing fields ...
  cacheReadTokens,
  cacheCreationTokens,
  costUsd: computeCostUsd(
    pricing,
    usage.input_tokens,
    usage.output_tokens,
    cacheReadTokens,
    cacheCreationTokens,
  ),
};
```

### 5. `scripts/hook-stop.ts` — live turn capture

Same change as ingest: read `cache_read_input_tokens` / `cache_creation_input_tokens` from the hook's usage payload and compute `costUsd` before calling `insertTurn`.

---

## Rollup Queries

### Daily spend (by day, all models)

```sql
SELECT
  date(created_at / 1000, 'unixepoch', 'localtime') AS day,
  model,
  SUM(input_tokens)          AS input_tokens,
  SUM(output_tokens)         AS output_tokens,
  SUM(cache_read_tokens)     AS cache_read_tokens,
  SUM(cache_creation_tokens) AS cache_creation_tokens,
  ROUND(SUM(cost_usd), 6)   AS cost_usd
FROM turns
JOIN sessions ON sessions.id = turns.session_id
GROUP BY day, model
ORDER BY day DESC;
```

### Session spend

```sql
SELECT
  s.id,
  s.name,
  s.model,
  SUM(t.cost_usd)            AS total_cost_usd,
  SUM(t.input_tokens)        AS input_tokens,
  SUM(t.output_tokens)       AS output_tokens,
  SUM(t.cache_read_tokens)   AS cache_read_tokens
FROM sessions s
JOIN turns t ON t.session_id = s.id
GROUP BY s.id
ORDER BY total_cost_usd DESC;
```

---

## Cross-Reference with Anthropic Console

**Manual workflow** (until Console API is available):

1. In a Claude Code terminal, run `/usage` — this returns daily spend and per-model token breakdowns from the Console.
2. Run the daily spend rollup query above against the local SQLite DB.
3. Compare `cost_usd` per day and model between the two sources.

**Expected divergence sources:**
- Turns from other tools or API callers not routed through Claude Code hooks (won't appear in the local DB).
- Cache write TTL mismatch: local DB uses 5-min rate; actual Console may reflect 1-hr TTL charges.
- Timing: Console billing day may differ from local `created_at` timezone.

**Acceptable delta:** < 5% for sessions exclusively using Claude Code. Larger delta indicates missed turns (hook not firing) or model mismatch.

---

## Implementation Order

1. `pricing.ts` — new file, no dependencies.
2. `types.ts` — promote optional fields, add `costUsd`.
3. `db.ts` — `migrate()` ALTER TABLE + `insertTurn()` extension + `rowToTurn()` mapping.
4. `ingest/` — wire cache fields and cost computation.
5. `hook-stop.ts` — same wiring for live turns.
6. `packages/server` — expose `/api/spend/daily` and `/api/spend/sessions` endpoints using the rollup queries.
7. `apps/desktop` — add a Spend tab or section to the Activity Monitor window.

---

## Open Questions

- **1-hr TTL detection:** Is the TTL type available anywhere in the API response or JSONL? If so, we can use the correct rate rather than always defaulting to 5-min.
- **Re-ingest cost on pricing change:** When rates change, historical `cost_usd` values become stale. Options: (a) always compute at query time from raw token columns using a versioned rate table, (b) add a `pricing_version` column. Currently leaning toward (a) for simplicity.
- **Haiku pricing:** The compaction engine uses `claude-haiku-4-5-20251001` for classifier calls. Those tokens are billed but not currently attributed to any session's cost. Should they be? They come from `packages/core/src/compaction.ts`, not from a user-facing turn.
