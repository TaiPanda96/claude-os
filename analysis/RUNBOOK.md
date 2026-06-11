# Claude OS — Phase 0 Analysis Runbook

## Hypothesis

> As a Claude Code session consumes a larger fraction of the context window, output quality degrades measurably before the session ends or is compacted. This degradation is invisible to the user and to Claude itself.

The **context efficiency curve** plots a composite quality proxy against context utilisation (%) for each session. The goal of Phase 0 is to empirically locate the inflection point — the context depth at which quality begins a consistent decline — and validate that it precedes the 80% hard-GC threshold.

---

## Data pipeline

```
~/.claude/projects/<project>/*.jsonl   ← Claude Code native session transcripts
          │
          ▼
scripts/ingest.ts                      ← bulk backfill (run once, idempotent)
scripts/hook-stop.ts                   ← live ingestion via Claude Code Stop hook
          │
          ▼
claude-os.sqlite                       ← sessions / turns / gc_events
  • input_tokens, output_tokens
  • cache_read_tokens, cache_creation_tokens
  • effective_input_tokens = input + cache_read + cache_creation
  • ctx_pct = effective_input / model_context_window
  • output_density = output_tokens / effective_input_tokens
  • self_correction_count  (markers: "actually,", "let me revise", …)
  • repetition_score       (bigram overlap with previous turn)
          │
          ▼
scripts/export.ts                      ← exports per-session CSV + JSON sidecar
          │
          ▼
analysis/sessions/<session_id>.csv     ← one row per turn
analysis/efficiency_curve.ipynb        ← this notebook
```

---

## How to run

### 1. Populate the database (if not already done)

```bash
# Backfill all historical sessions
bun run scripts/ingest.ts

# Verify
bun -e "
import { Database } from 'bun:sqlite';
const db = new Database('claude-os.sqlite');
console.log(db.prepare('SELECT COUNT(*) as n FROM turns').get());
"
```

### 2. Export session CSVs

```bash
bun run --cwd packages/core export
# CSVs land in analysis/sessions/
```

### 3. Run the notebook

```bash
cd analysis
jupyter notebook efficiency_curve.ipynb
# Cell → Run All  (⌘⇧↩)
```

Or headless:

```bash
jupyter nbconvert --to notebook --execute analysis/efficiency_curve.ipynb \
  --output analysis/efficiency_curve_out.ipynb
```

### 4. Tune filters (optional)

In the second code cell of the notebook:

| Variable | Default | Effect |
|---|---|---|
| `MIN_TURNS` | `30` | Drop sessions with fewer turns — too short to show a curve |
| `MAX_SESSIONS` | `12` | Cap the grid; highest-turn sessions are kept first |
| `NAME_FILTER` | `None` | Substring match on session name, e.g. `'finance'` |

---

## Quality proxy

The composite quality signal combines three per-turn metrics, each normalised to [0, 1] within the session:

```
quality = 0.5 × output_density_norm
        + 0.3 × (1 − self_correction_norm)
        + 0.2 × (1 − repetition_norm)
```

| Component | Weight | Rationale |
|---|---|---|
| `output_density` | 50% | Primary signal. Tokens out / effective tokens in. Drops when Claude is spending context budget receiving context rather than generating useful output. |
| `self_correction_count` | 30% | Proxy for confidence. Higher correction rate correlates with hedging and revision loops. |
| `repetition_score` | 20% | Bigram overlap with the previous turn. High overlap indicates Claude is re-stating rather than advancing. |

**Limitation:** Claude Code sessions are tool-use heavy. Self-correction and repetition signals are near-zero because most turns are short tool invocations, not prose. Output density is the dominant signal for this dataset. Prose sessions (direct API wrapper) would activate all three components more evenly.

---

## Inflection detection

The inflection point is estimated per session:

1. Smooth the quality curve with a Savitzky-Golay filter (window = `max(3, n_turns // 5)`)
2. Compute a rolling linear regression slope over the same window
3. Return the first context utilisation value where the slope is negative for 2+ consecutive windows

---

## Phase 0 results (run: 2026-06-11)

**Dataset:** 146 sessions · 10,063 turns · 52 GC events  
**Corpus:** Claude Code sessions across `find-doc`, `finance`, `claude-dynamic-island` projects

### Aggregate quality by GC state

| GC state | Turns | Avg output density | vs. clean |
|---|---|---|---|
| Clean (< 60%) | 7,966 | 0.0170 | — |
| Soft GC (60–80%) | 941 | 0.0100 | −41% |
| Hard GC (> 80%) | 1,156 | 0.0068 | −60% |

Output density drops 41% entering soft GC and 60% at hard GC relative to clean-state turns.

### Per-session summary (top 12 by turn count)

| Session | Turns | Max ctx% | Avg output tokens | Quality r | Inflection |
|---|---|---|---|---|---|
| find-doc · c2c2efd3 | 648 | 385% | 2,191 | −0.341 | 109% |
| find-doc · e68608c5 | 362 | 191% | 1,670 | −0.188 | 48% |
| find-doc · 645c3b26 | 310 | 128% | 1,066 | −0.398 | 47% |
| find-doc · 9f027ad3 | 230 | 93% | 1,000 | −0.244 | 30% |
| find-doc · 40de19e3 | 213 | 86% | 647 | −0.271 | 38% |
| find-doc · c9e816d0 | 209 | 80% | 2,862 | −0.218 | 45% |
| find-doc · 05afca3f | 194 | 102% | 967 | +0.067 | 37% |
| find-doc · 7a419784 | 190 | 124% | 1,760 | −0.286 | 33% |
| find-doc · 3d052dce | 187 | 79% | 889 | −0.284 | 37% |
| finance · fd59c881 | 180 | 68% | 544 | −0.107 | 29% |
| find-doc · f3f57e1b | 168 | 87% | 1,294 | −0.128 | 27% |
| claude-dynamic-island | 163 | 55% | 647 | −0.332 | 23% |

### Key findings

1. **Negative correlation is consistent.** 11 of 12 sessions show a negative Pearson r between context utilisation and quality proxy. The exception (`05afca3f`, r=+0.07) is near-zero and likely a flat session with no clear trend.

2. **Inflection precedes the 80% hard-GC threshold.** The median inflection point across sessions is ~37% context utilisation — well before the soft-GC boundary at 60%. This means quality begins declining at roughly **half the context window**, not at the GC thresholds currently used as heuristics.

3. **The degradation is not linear.** Curves show a characteristic shape: stable early, then a step-down around the inflection, then a floor. The 60%/80% thresholds are late signals, not early warnings.

4. **Find-doc is the highest-signal corpus.** These sessions are long (187–648 turns), reach deep context (79–385%), and show the clearest degradation curves. Sessions that stay under 50% context are too short to exhibit the pattern.

---

## Next steps (Phase 1+)

- **Phase 1 — Menu bar sprite:** Poll `claude-os.sqlite` every 5s and surface `ctx_pct` + `gc_state` as a macOS menu bar icon with colour coding (green / amber / red).
- **Phase 2 — Activity Monitor window:** Full session detail view via the Hono server at `localhost:7842`, consumed by an Electron shell.
- **Phase 3 — Proactive compaction:** Trigger a compaction suggestion when the hook detects `gc_state = hard_gc` or when the rolling slope turns negative for 3+ consecutive turns.
- **Phase 5 — MCP introspection:** Expose the SQLite store via MCP so Claude can query its own context health mid-session.
