# Claude OS — Terminology

Precise definitions for the concepts Claude OS measures and surfaces.

---

## Token

The atomic unit of text that Claude processes. Roughly 3–4 characters of English, or about ¾ of a word. Claude thinks and communicates exclusively in tokens — it never sees raw characters.

Every API response includes a usage breakdown:

| Field | Meaning |
|---|---|
| `input_tokens` | Tokens Claude read this turn (prompt + history, excluding cache) |
| `output_tokens` | Tokens Claude generated in its response |
| `cache_read_input_tokens` | Tokens read from the prompt cache (previously computed) |
| `cache_creation_input_tokens` | Tokens written into the prompt cache this turn |

**Effective input** is the total context Claude actually consumed:
```
effective_input = input_tokens + cache_read_input_tokens + cache_creation_input_tokens
```

Cache tokens count toward context utilisation even though they're cheaper — Claude still had to attend over them.

---

## Context Window

The maximum number of tokens Claude can hold in "working memory" at once. It is a hard ceiling set by the model.

| Model | Context window |
|---|---|
| claude-sonnet-4-6 | 200,000 tokens |
| claude-opus-4-8 | 200,000 tokens |
| claude-haiku-4-5 | 200,000 tokens |

**Context utilisation** (`ctx_pct`) is how full that window currently is:
```
ctx_pct = effective_input / ctx_window
```

At 100% utilisation, Claude cannot receive any more input. In practice, quality begins degrading well before 100% — Phase 0 found the median inflection point is around 37%.

---

## Turn

One exchange in a conversation: a user message followed by a Claude response. Each turn has its own token usage snapshot — the effective input for a turn includes the entire conversation history up to that point, not just the new message.

In Claude Code, a turn corresponds to one agent loop completion: the user sends a prompt (or a tool result), Claude responds and optionally calls tools, and the loop closes. The Stop hook fires at the end of each turn.

Turn-level fields tracked by Claude OS:
- `input_tokens`, `output_tokens`, `effective_input_tokens`
- `ctx_pct` — context utilisation at this moment
- `latency_ms` — wall time from user message to assistant response
- `output_density` — `output_tokens / effective_input_tokens`
- `self_correction_count` — how often Claude second-guessed itself
- `repetition_score` — bigram overlap with the previous turn's output

---

## Session

A continuous conversation thread. In Claude Code, a session maps to a single JSONL file under `~/.claude/projects/<project>/`. A session starts when you open a new conversation and ends when you close it or it is compacted.

Sessions accumulate turns. The context window fills progressively across turns because each turn's effective input includes all prior history. A session that runs long enough will eventually saturate the context window.

Session-level fields tracked by Claude OS:
- `model`, `ctx_window`
- `status` — `active` or `closed`
- `outcome_status` — `unresolved` (default) or `resolved`
- `created_at`, `last_active_at`

---

## GC (Garbage Collection)

Borrowed from systems programming: the process of reclaiming memory that is no longer needed. In Claude's context, GC refers to **context compaction** — the mechanism by which Claude Code summarises and discards earlier conversation history to free up space in the context window.

Claude Code performs GC automatically when the context window approaches capacity. The user has no direct control over when it happens or what gets discarded. After GC, the session continues but with a compressed history — some detail is permanently lost.

Claude OS models GC as a state machine based on `ctx_pct`:

| State | Threshold | Meaning |
|---|---|---|
| **Clean** | < 60% | Healthy. Full context available, quality nominal. |
| **Soft GC** | 60–80% | Warning zone. Quality beginning to degrade. Compaction may be beneficial soon. |
| **Hard GC** | > 80% | Danger zone. Quality measurably degraded. Compaction is likely imminent or overdue. |
| **Aged** | session closed | Session ended without resolution. |

**Why these thresholds?** The 60% / 80% boundaries are heuristics informed by Phase 0 data. The empirical inflection point (where quality starts declining) was found at a median of ~37% — earlier than the thresholds. The thresholds are conservative late signals, not early warnings. Phase 3 will introduce proactive warnings based on the rolling slope rather than fixed thresholds.

---

## Output Density

The ratio of tokens Claude produced to tokens Claude consumed:
```
output_density = output_tokens / effective_input_tokens
```

A high density means Claude is generating substantive output relative to the context it holds. A low density means Claude is "reading" far more than it is "writing" — a sign that the context window is dominated by history rather than the current task.

In Phase 0 data, output density dropped 60% at hard GC relative to clean-state turns. It is the single strongest quality signal in tool-use-heavy sessions.

---

## Context Quality

The composite per-turn quality proxy — a single 0–1 score blending three signals. This is the metric plotted as **Output Quality** in the desktop app, and the one GC trajectory projections are built on.

```
quality = 0.5 × min(1, output_density / 0.4)            # productivity
        + 0.3 × (1 − min(1, self_correction_count / 5)) # confidence
        + 0.2 × (1 − repetition_score)                  # novelty
```

| Component | Weight | What it captures | Scaling |
|---|---|---|---|
| Output density | 0.5 | Is Claude writing substantively vs. just reading history? | Normalised against a fixed anchor of **0.4** (empirical max ~0.34), clamped to 1 |
| Self-correction | 0.3 | Is Claude second-guessing itself? `self_correction_count` matches 16 marker phrases | Normalised against a soft ceiling of **5**, clamped; more corrections → lower score |
| Repetition | 0.2 | Is Claude repeating itself? `repetition_score` is bigram overlap with the previous turn | Already 0–1; used as `1 − score` so novel output scores higher |

The anchors are **fixed**, not per-session min-max — a weak session that peaks at 0.15 density should *not* be stretched to look identical to a strong one peaking at 0.34. That keeps scores comparable across sessions.

> **Single source of truth:** the formula and its anchor constants (`OUTPUT_DENSITY_ANCHOR`, `SELF_CORRECTION_ANCHOR`) live in `packages/core/src/domain/quality-proxy.ts` (`qualityForTurn`). The renderer and server-side stats both import it — there is no longer a "change two copies in sync" hazard.

**Watch for:** sustained drops past 60% context. The earlier the drop relative to context fill, the more the growing context is hurting output. A quality below the floor (**0.3**) marks low-value output and anchors the `turnsToInflection` projection.

---

## Marginal Density (Context Bloat Rate)

How fast the context window is inflating relative to the useful output a turn produces — the answer to *"am I paying more and more context for the same amount of work?"*

```
new_ctx_tokens[i] = max(0, effective_input[i] − effective_input[i−1])
marginal_density  = new_ctx_tokens / output_tokens          # the raw ratio, e.g. "12x"
```

`new_ctx_tokens` is the turn-over-turn growth in context the model had to read (`effective_input = cumulative_tokens − output_tokens`). **Turn 0 is defined as 0** — its context is the fixed base prompt (system prompt + tool defs + CLAUDE.md), a one-time cost, not bloat the session introduced.

- **Raw value** (`marginalDensityRaw`) is the unbounded ratio, shown as `12.0x` in the UI.
- **Scaled value** (`marginalDensity`, 0–1) divides the raw ratio by a fixed anchor of **8** and clamps — so the plotted curve is comparable across sessions and one spike (e.g. a large file read) can't compress every other turn toward zero.
- **Edge case:** context grew with *zero* output. That is the worst case, not the best, so it saturates at the anchor rather than reporting 0 (a naive `x/0` guard would invert the signal).
- **Session summary** reports `avgMarginalDensity` — the mean raw ratio across the session (labelled "Marginal density", in `Nx`).

**Watch for:** a rising ratio means context is growing faster than the work it produces — the session is approaching diminishing returns.

---

## Token Cost / Artifact (Work Efficiency)

The marginal token cost of producing one *meaningful* turn, measured over a trailing window. Where Marginal Density asks "context vs. output volume," this asks "context vs. **useful** output" — and it is the cleanest leading indicator of GC pressure.

```
artifact[i]      = output_tokens[i] ≥ running median of outputs[0..i]   # a "useful" turn
work_efficiency  = Σ new_ctx_tokens over trailing 10 turns
                 ÷ max(1, artifacts in that window)                     # tokens per artifact
```

- **Artifact** = a turn whose output is at or above the *running (prefix) median* output. The threshold is **causal** — a turn's classification never depends on turns that haven't happened yet (an earlier whole-session median did, and would change retroactively).
- **Trailing window** = 10 turns. A cumulative average climbs ~linearly with turn count for *any* session; this trailing form stays flat while healthy and rises only when context grows faster than useful output appears.
- **0 artifacts in the window** = maximally inefficient: the denominator floors at 1, surfacing the full window's context cost rather than dividing by zero.
- **Scaling:** tokens-per-artifact spans orders of magnitude, so the 0–1 value is **log-scaled** between a floor of **1,000** (→ 0, efficient) and a ceiling of **100,000** (→ 1, badly degraded); the geometric midpoint (~10k) sits at 0.5.
- **Session summary** reports `currentWorkEfficiency` — the raw tokens-per-artifact at the latest turn (labelled "Work efficiency").

**Watch for:** a rising curve is GC pressure — context is growing faster than useful output appears, so each meaningful turn is getting more expensive.

> **Anchors** (`MARGINAL_DENSITY_ANCHOR`, `WORK_EFFICIENCY_FLOOR`, `WORK_EFFICIENCY_CEIL`) live in `packages/core/src/domain/quality-proxy.ts`; the per-turn series is computed in `apps/desktop/src/renderer/quality.ts` (`computeQuality`).

---

## Prompt Cache

An Anthropic infrastructure feature that stores computed key-value pairs from previous requests. When the same prefix appears again, those tokens are read from cache rather than recomputed — faster and cheaper.

Cache tokens still consume context window space. Claude OS accounts for them in `effective_input_tokens` because quality degradation is driven by total context consumed, regardless of how cheaply it was processed.
