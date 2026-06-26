# Claude OS

> **A policy-driven advisor for your coding agents.** Define how a project should
> spend its context budget; Claude OS measures every session against that policy,
> tells you the one action that keeps it efficient, and turns bloated sessions
> into durable memory the next session inherits.

> Positioning & product spine: [`PRODUCT.md`](./PRODUCT.md). This README is the technical tour.

![Phase](https://img.shields.io/badge/phase-4%20%E2%80%94%20policy%20UI-34c759?style=flat-square)
![License](https://img.shields.io/badge/license-MIT-blue?style=flat-square)
![Built with](https://img.shields.io/badge/built%20with-TypeScript%20%2B%20Swift-orange?style=flat-square)
![Status](https://img.shields.io/badge/status-active%20development-yellow?style=flat-square)

---

## The problem

Every Claude session has a **context efficiency curve**. In the early portion of a session, each input produces high-quality, well-grounded output. Past a certain token depth — typically around 70–80% of the context window — the signal-to-noise ratio of accumulated context degrades. The model attends equally to stale intermediate outputs, abandoned threads, and retried phrasings as it does to your original goals and constraints.

This is the **garbage threshold**. It's currently invisible to users — and the only tools you have to act on it are blunt: clear the session, or let it rot.

Claude OS makes it visible, measurable, and **actionable on your terms**. Not a black box that silently compresses your context (the autopilot model), but an **advisor**: it explains *why* a session is degrading and recommends *what to do about it*, then executes that action on one click.

---

## The one primitive: a Policy

Everything in Claude OS hangs off one concept — **a policy, attached to a project.** A policy answers three questions and nothing else:

| A policy defines | The question | Examples |
|---|---|---|
| **Metrics** | *What do we measure?* | context utilisation %, token spend / turn, Quality Proxy, Work Efficiency, GC state |
| **Triggers** | *When do we compact?* | turn cadence, context threshold, architectural-decision / outcome-resolved detection, custom semantic classifier |
| **Eviction** | *What gets written to memory, and when is it stale?* | per-file memory schema — update mode (overwrite / append / merge), decay scope (session / project / permanent) |

You write a policy once per project. From then on, Claude OS runs one loop: **Track → Advise/Execute → Manage memory.**

## What it does

**Tracks** — instruments Claude Code sessions via a `Stop` hook and computes, per turn:
- Token spend per turn — cache-aware (read / creation / effective input), priced
- A **Quality Proxy** (output density, self-correction markers, turn-over-turn repetition) and the session degradation curve (peak, inflection, trend)
- **Work Efficiency** across the curve, rolled up into a four-state GC status: `Clean → Soft GC → Hard GC → Aged`
- Every metric exists because a policy *trigger* can fire on it — measurement and policy share one vocabulary

**Advises & executes** — policy-driven compaction:
- When a policy's triggers are met, Claude OS surfaces a single **prescriptive recommendation** with projected savings (tokens & context freed, cost avoided)
- The recommendation *is* the action — one click runs the same `policy-driven-compaction` an automatic trigger would, distilling turns into the memory schema. There is no separate "manual" path with different rules
- One verb, two lineage choices: **compact in place** (session continues, leaner) or **compact & fork** (branch a fresh session seeded with distilled context)

**Manages memory** — the durable artifact:
- Compaction writes a typed, inspectable memory store under `~/.claude/projects/<cwd>/claude-os/memory/`, seeded into every new Claude session in that project
- **Read, export, and manage** it; every action links to what it wrote, so the loop closes
- **Organises** sessions by project topology — a **By Project** tree or a flat **By Session** view, with per-project policy banners

---

## Design principle: context minimalism, across the session boundary

Anthropic's guidance for working with Claude is **context minimalism** — the smallest set of high-signal tokens that maximizes the likelihood of the right outcome. Claude OS is built to serve that principle, not fight it. The distinction that makes a *memory system* compatible with minimalism:

> Context minimalism constrains the **working context of a single inference** — the tokens competing for attention. It does not constrain what you persist on disk. **Storage is free; context is expensive.**

So the layers of this system divide cleanly. Compacting a session into typed files on disk costs the model zero attention — it's distillation, not loading. Eviction and token budgets *bound* the store, keeping retrieval cheap. The only operation that spends the attention budget is **seeding** memory into a new session — so that is the only place held to a strict minimalist standard: Claude OS seeds a thin **index** of what durable knowledge exists and lets the model pull the bodies just-in-time, rather than force-loading everything at session start.

This is also why Claude OS is **complementary to native compaction, not a competitor.** Native compaction minimizes context *within* a session, under duress near the limit, and discards the result when the session ends. Claude OS minimizes the context a *new* session inherits — across a boundary the model is structurally blind to, with the result persisted, bounded, and observable. The litmus test we hold ourselves to: *a session with memory must reach productive work in fewer tokens than the same session cold-started.* If memory doesn't pay for itself, it's a preamble tax — and we measure it.

> Full lifecycle design: [`docs/specs/spec-memory-eviction-lifecycle.md`](./docs/specs/spec-memory-eviction-lifecycle.md).

---

## GC State Machine

The GC state is one of the **metrics** a policy measures; crossing a threshold is what a **trigger** fires on and what the advisor recommends acting upon.

| State | Condition | Recommended action |
|---|---|---|
| **Clean** | ctx < 60% | Continue normally |
| **Soft GC** | ctx 60–80% | Compact before continuing — leaner context, same session |
| **Hard GC** | ctx > 80% | Compact & fork — new session seeded with distilled context |
| **Aged** | Closed, unresolved | Archive to persistent project memory |

Transitions are one-way within a session. A forked session starts Clean. Thresholds are policy-configurable; defaults live in `GC_THRESHOLDS`.

---

## Architecture

```
claude-os/
├── packages/
│   ├── core/          TypeScript ingestion, SQLite schema, DB access layer, pricing, compaction
│   └── server/        Hono API server (localhost:7842) — sessions, projects, spend, policy, SSE
├── apps/
│   └── desktop/       Electron + React advisor window
├── scripts/           Bulk ingest, export, and Claude Code Stop hook
├── analysis/          Phase 0 notebooks — efficiency curve empirics
└── docs/              Architecture, compaction templates, research notes
```

### Stack

| Layer | Choice |
|---|---|
| Runtime | Bun ≥ 1.1 |
| Session capture | Claude Code `Stop` hook (JSONL transcripts) |
| Local store | SQLite via `bun:sqlite` (built-in, no ORM) |
| Local server | Hono |
| Main window | Electron + React + Vite |
| Charts | Recharts |
| State | Zustand |
| Compaction LLM | Claude Sonnet 4.6 (`claude-sonnet-4-6`) |
| Pricing | Per-model cost table in `packages/core/src/pricing.ts` |
| Real-time push | Server-Sent Events (`/events` endpoint) |

---

## Getting started

> Full setup details are in [RUNBOOK.md](./RUNBOOK.md). This is the short path.

**Prerequisites**

- [Bun](https://bun.sh) ≥ 1.1
- [Node.js](https://nodejs.org) ≥ 20 (required by Electron)
- [Claude Code CLI](https://claude.ai/code) — installed and active
- macOS (Electron tray and notifications are macOS-only)

```bash
git clone https://github.com/TaiPanda96/claude-os.git
cd claude-os
bun install
```

**1. Run setup**

```bash
bun run setup
```

This checks prerequisites (Bun, Node, Claude Code CLI), wires the `Stop` hook into `~/.claude/settings.json` with the correct absolute path, and tells you how many existing transcripts are available to ingest. Safe to re-run — idempotent.

**2. Ingest existing sessions (optional)**

If you have existing Claude Code sessions to analyse:

```bash
bun run ingest          # bulk ingest from ~/.claude/projects/
bun run export          # export sessions as JSON → analysis/sessions/
```

**3. Start the advisor**

```bash
bun run dev
```

This runs four processes concurrently — Hono API server (`:7842`), Vite renderer (`:5173`), TypeScript watch, and Electron. The tray icon appears in your macOS menu bar; left-click to open the advisor window.

**Verify the server is up:**

```bash
curl http://localhost:7842/health
# {"status":"ok","version":"0.1.0"}
```

See [RUNBOOK.md](./RUNBOOK.md) for troubleshooting, environment variables, and TypeScript conventions.

---

## Database schema

Five tables, managed by an append-only migration runner (`packages/core/src/db/migrate.ts`). Each migration runs once, in its own transaction, tracked by a `migrations` table.

```sql
projects(id, cwd, name, created_at)

sessions(
  id, name, model, ctx_window,
  created_at, last_active_at,
  status, outcome_status,
  project_id,           -- FK → projects
  forked_from           -- FK → sessions (self-referential fork chain)
)

turns(
  id, session_id, turn_index,
  input_tokens, output_tokens, cumulative_tokens,
  cache_read_tokens, cache_creation_tokens, effective_input_tokens,
  ctx_pct, latency_ms, stop_reason,
  self_correction_count, repetition_score, output_density,
  pricing_version, cwd,
  created_at
)

gc_events(id, session_id, gc_type, ctx_pct_at_trigger, created_at)

compaction_policies(
  id, project_id,       -- one policy per project
  name, active, config,
  created_at, updated_at
)

compaction_events(
  id, session_id, policy_id,
  triggered_by, trigger_detail,
  files_written, tokens_at_trigger, output_size_tokens,
  status,               -- running | completed | failed
  started_at, completed_at, error
)
```

---

## Roadmap

### Phase 0 — Proof of Concept `✓`
- [x] Claude Code hook — per-turn token capture via JSONL transcripts
- [x] Session-level context utilisation % computed from cumulative tokens
- [x] Quality proxy logging: output length, latency, self-correction rate
- [x] SQLite store + post-hoc efficiency curve notebook
- [x] Empirical identification of quality inflection point across real sessions

### Phase 1 — Menu Bar Sprite `✓`
- [x] macOS menu bar app — Swift / AppKit `NSStatusItem`
- [x] Real-time context depth indicator, colour-coded GC state
- [x] Native `UNUserNotificationCenter` alerts at threshold crossings
- [x] Configurable GC threshold (default: 80%)

### Phase 2 — Activity Monitor Window `✓`
- [x] Full panel: sortable session list, live efficiency curve chart
- [x] Electron + React, IPC to SQLite, macOS vibrancy
- [x] Turn-by-turn token breakdown, GC event log

### Phase 3 — Compaction Engine `✓`
- [x] One-click compaction (compact in place / compact & fork) from the per-session action overflow
- [x] Compaction reads JSONL transcripts directly — summarises user/assistant turns into structured memory files under `~/.claude/projects/<cwd>/claude-os/memory/`
- [x] Per-project compaction policy — configurable triggers (turn cadence, context %) stored in SQLite, editable from the UI
- [x] Policy & Memory panel — view and manage per-project policies; peer into the memory files written by each compaction run
- [x] Compaction event log with status tracking (`running | completed | failed`) and output token counts
- [x] Context window resolved from plan tier at ingest time (`resolveContextWindow`) — Max plan sessions correctly use 1M window, not 200K

### Phase 4 — Cost Telemetry & Outcomes `← current`
- [x] Per-turn cost computed from live pricing table (`packages/core/src/pricing.ts`) — Sonnet 4.6, Haiku 4.5, Opus 4.8 rates
- [x] Cache-aware cost: separates `cache_read_tokens`, `cache_creation_tokens`, `effective_input_tokens`
- [x] Daily spend view and per-session spend view in the advisor
- [x] Project-level cost rollup in the By Project tree
- [ ] Cost-per-outcome reporting (API spend / resolved work items)
- [ ] Stalled session detection + escalation

### Phase 5 — Advisor & Ergonomics `← next`
- [ ] Prescriptive recommendation surface — proactively present the single best action (with projected token/cost savings) when a policy trigger is met, rather than only on-demand in the compaction modal
- [ ] Front-end refactor — collapse the Compact / Fork / Compact & Fork actions into one **Compact** verb with a lineage choice; promote *peer-into-memory* next to the actions that write memory
- [ ] Landing page refactor — lead with use cases and the Advisor positioning from [`PRODUCT.md`](./PRODUCT.md)
- [ ] Split the policy model in the UI — **Metrics / Triggers / Eviction** as distinct sections; manual compaction depends only on the memory schema, never erroring on "no active policy"

### Phase 6 — Public Release
- [ ] MCP server — Claude reads its own context health in real time, and can request compaction by policy
- [ ] Empirical research write-up: efficiency curves across session types
- [ ] `brew install claude-os`

---

## Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md) for code style, commit conventions, and how to open a PR.

Phase 4 is the active work surface. The most useful contributions right now:

- **Cost-per-outcome modeling** — connecting API spend to resolved work items or session outcomes
- **Quality proxy improvements** — better signal for output density or self-correction detection
- **Cross-platform feedback** — the hook and ingest pipeline should work on Linux; reports welcome

Issues are open. No Discord.

---

## Research context

Claude OS is being developed as both a practical tool and a research contribution — an empirical measurement of context efficiency as a user-facing primitive. The goal is to demonstrate that the garbage threshold is real, measurable, and actionable before it becomes a first-party feature.

---

## License

MIT © [Tai Lin](https://github.com/TaiPanda96)

---

*Built in Toronto. Phase 4 — June 2026.*