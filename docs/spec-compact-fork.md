# Spec: Compact & Fork

**Status:** Draft  
**Date:** 2026-06-15  
**Depends on:** spec-cost-telemetry.md (for cost_usd column and MODEL_PRICING)

---

## What This Is

A per-session row action in the Activity Monitor that lets a user:

1. **Compact** — trigger compaction on a session immediately (already possible via `POST /sessions/:id/compact`), writing distilled memory files to disk.
2. **Fork** — create a new DB session record with `forked_from = <parent_id>`, so the lineage is tracked and the memory files written by the compact step are available for the child session.
3. **Understand the savings** — before committing, see exactly how many tokens and dollars would be freed if they forked into a fresh context window right now.

The fork does **not** launch a new Claude Code process — it creates the DB record and the memory files. The user opens a new Claude Code session in the same project directory; Claude Code's own hook picks it up and the new session starts with a near-empty context window, memory files already on disk at `~/.claude/projects/<encoded-cwd>/claude-os/memory/`.

---

## Why It's Interesting

Right now compaction is automatic and invisible. Users don't know it happened, can't trigger it deliberately, and can't see what was saved. This feature makes the economics of context management legible:

- "You're at 73% context. Compacting now frees ~146K tokens (~$0.44 in future input cost)."
- "Your last compaction saved 17.7K tokens."
- The fork lineage in the DB creates a tree of sessions — a history of how a long project was managed across context windows.

---

## User Flow

```
Session table row (soft_gc or hard_gc state)
  └─ [Compact & Fork] button appears on hover (rightmost column)
       │
       ▼
  Savings preview tooltip / inline expansion:
    ┌─────────────────────────────────────────┐
    │  Compact & Fork                         │
    │  Current context: 73% · 146K tokens     │
    │                                         │
    │  Compacting now frees:                  │
    │    ~146K tokens                         │
    │    ~68% of context window               │
    │    ~$0.44 in future input cost          │
    │                                         │
    │  Memory files: decisions · code-state   │
    │  (2 files · last updated 4 turns ago)   │
    │                                         │
    │  [Cancel]  [Compact & Fork]             │
    └─────────────────────────────────────────│
       │ on confirm
       ▼
  POST /sessions/:id/compact  (existing endpoint)
  POST /sessions/:id/fork     (new endpoint)
       │
       ▼
  Row updates: new child session appears in table
  Parent row shows fork badge: "⑂ forked → <child_id[:6]>"
  Toast: "Compact complete — fork abc123 ready. Open a new Claude session in this project."
```

---

## Token Savings Estimate

The estimate shown in the preview is computed client-side from data already available on the session row:

```ts
// Tokens currently in context
const currentTokens = Math.round(session.current_ctx_pct * session.ctx_window);

// Estimated post-compaction size: average of historical compaction events for this session
// Fall back to a 15% heuristic if no prior events exist (memory files are ~15% of source)
const compressionRatio = lastCompactionEvent
  ? lastCompactionEvent.output_size_tokens / lastCompactionEvent.tokens_at_trigger
  : 0.15;

const estimatedSummaryTokens = Math.round(currentTokens * compressionRatio);
const tokensSaved = currentTokens - estimatedSummaryTokens;
const pctFreed = tokensSaved / session.ctx_window;

// Cost: tokens saved × input rate (future sessions won't have to re-read this context)
const pricing = MODEL_PRICING[session.model] ?? MODEL_PRICING["claude-sonnet-4-6"];
const costSaved = (tokensSaved / 1_000_000) * pricing.inputPerM;
```

**Note:** `output_size_tokens` needs to be added to `compaction_events` (see schema changes below) to make the ratio accurate. Until then, use the 0.15 heuristic.

---

## Schema Changes

### `compaction_events` — add output size

The existing table tracks `tokens_at_trigger` (input size) but not the output size. Add:

```sql
ALTER TABLE compaction_events ADD COLUMN output_size_tokens INTEGER NOT NULL DEFAULT 0;
```

Populate in `compaction.ts` after memory files are written: sum the token count of all written file contents (approximated as `charCount / 4`).

### `sessions` — `forked_from` already exists

No schema change needed. The `forked_from TEXT REFERENCES sessions(id)` column is already in the schema and wired in `upsertSession`.

---

## API Changes

### New: `POST /sessions/:id/fork`

Creates the child session record. Called immediately after compact completes.

**Request body:**
```json
{ "name": "optional override name" }
```

**Behavior:**
1. Load the parent session from DB.
2. Create a new session with:
   - Fresh `id` (uuidv4)
   - `forked_from = parent.id`
   - `model = parent.model`
   - `ctx_window = parent.ctx_window`
   - `status = 'active'`
   - `name = name ?? parent.name + " (fork)"`
   - `project_id = parent.project_id`
   - `cumulative_tokens = 0`, `turn_count = 0`
3. Return `{ id, name, forked_from }`.

**Response:** `201 Created` with the new session object.

### Existing: `POST /sessions/:id/compact`

No changes needed — this already triggers compaction and writes memory files. The fork endpoint is called after this resolves.

### Extend: `GET /sessions/:id`

Return `forked_from` and a `forks: string[]` list (child session IDs) so the UI can render lineage.

---

## UI Changes

### `session-table.tsx` — row action button

Add a "Compact & Fork" button that appears on row hover, but **only** when `gc_state` is `soft_gc` or `hard_gc` (the action is meaningful when context pressure exists).

```tsx
// On row hover, render in the GC State column area (rightmost):
{(state === "soft_gc" || state === "hard_gc") && (
  <button
    style={styles.compactForkBtn}
    onClick={(e) => {
      e.stopPropagation(); // don't trigger row select
      onCompactFork(s.id);
    }}
  >
    ⑂ Compact & Fork
  </button>
)}
```

The button replaces or overlays the GC chip on hover — no extra column needed.

### New: `CompactForkModal` component

A small inline modal (not full-screen) anchored near the row that shows the savings estimate and a confirm button. Calls `POST /compact` then `POST /fork` in sequence. Polls `/sessions/:id/compaction-events` for completion (the existing SSE stream can also be used).

**States:**
1. `preview` — show savings estimate, Cancel / Compact & Fork buttons.
2. `compacting` — spinner, "Compacting…" — disable cancel.
3. `done` — show "Fork abc123 ready. Open a new Claude session in this project directory." with a Copy Path button.
4. `error` — show error message with Retry.

### `session-table.tsx` — fork lineage badge

On the parent session row, after a fork exists, show a small badge after the session name:

```
⑂ → abc123
```

Clicking the badge selects the child session row.

### New column consideration

The table currently has: Session · Model · Context Depth · CTX % · Turns · GC State.

Adding a "Savings" column showing `~$X.XX` estimated future cost saved (from cost telemetry) is a natural companion. This requires the cost telemetry spec to land first.

---

## Data Flow

```
User clicks "Compact & Fork"
        │
        ▼
CompactForkModal opens (savings preview computed client-side)
        │
User confirms
        │
        ▼
POST /sessions/:parentId/compact
        │ (existing — triggers compaction.ts, writes memory files)
        ▼
Poll /sessions/:parentId/compaction-events until status = 'completed'
        │
        ▼
POST /sessions/:parentId/fork
        │ (new — creates child session record in DB)
        ▼
Child session appears in session table
Parent row shows ⑂ badge
Toast notification
```

---

## What the User Does Next

After the fork completes, the user:

1. Opens a terminal in the same project directory.
2. Runs `claude` (or opens a new Claude Code window pointed at that directory).
3. The new session starts with an empty context window.
4. The memory files written by compaction are at `~/.claude/projects/<encoded-cwd>/claude-os/memory/` — if they've configured CLAUDE.md or a hook to load these, the new session picks up where the old one left off.

**Future enhancement:** Auto-generate a CLAUDE.md snippet that loads the memory files, copy it to clipboard as part of the "done" state in the modal.

---

## Implementation Order

1. **`compaction_events` migration** — add `output_size_tokens` column, populate in `compaction.ts`.
2. **`POST /sessions/:id/fork`** — new Hono route in `packages/server/src/index.ts`.
3. **`GET /sessions/:id`** — extend to return `forked_from` and `forks[]`.
4. **`CompactForkModal`** — new component in `apps/desktop/src/renderer/components/`.
5. **`session-table.tsx`** — hover button + lineage badge, `onCompactFork` prop.
6. **`App.tsx`** — wire `onCompactFork` handler, modal state.

Cost telemetry (spec-cost-telemetry.md) can land in parallel — the Compact & Fork feature shows savings estimate without it, and adds the `~$X.XX` column once it's available.

---

## Open Questions

- **Session name UX:** Should the fork prompt the user to name the new session, or auto-name it? Auto-name with " (fork)" suffix keeps the flow fast; a name prompt adds friction but improves the session list legibility.
- **Compact-only (no fork):** Should the button also offer "Compact only" (no new session record)? Useful for freeing future context without committing to a fork.
- **Memory file preview:** Should the savings modal show a collapsed preview of what was written to memory? Builds trust ("here's what got preserved") but adds complexity.
- **Hook attribution:** When the new forked session's turns are ingested, they have `forked_from` on the session record. Should we surface "this session inherited N tokens of memory from parent" in the detail panel?
