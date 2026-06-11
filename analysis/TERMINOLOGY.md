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

## Prompt Cache

An Anthropic infrastructure feature that stores computed key-value pairs from previous requests. When the same prefix appears again, those tokens are read from cache rather than recomputed — faster and cheaper.

Cache tokens still consume context window space. Claude OS accounts for them in `effective_input_tokens` because quality degradation is driven by total context consumed, regardless of how cheaply it was processed.
