# Claude OS

> A macOS activity monitor for Claude sessions. Real-time token economics, context window health, and GC state tracking — before quality degrades.

![Phase](https://img.shields.io/badge/phase-4%20%E2%80%94%20policy%20UI-34c759?style=flat-square)
![License](https://img.shields.io/badge/license-MIT-blue?style=flat-square)
![Built with](https://img.shields.io/badge/built%20with-TypeScript%20%2B%20Swift-orange?style=flat-square)
![Status](https://img.shields.io/badge/status-active%20development-yellow?style=flat-square)

---

## The problem

Every Claude session has a **context efficiency curve**. In the early portion of a session, each input produces high-quality, well-grounded output. Past a certain token depth — typically around 70–80% of the context window — the signal-to-noise ratio of accumulated context degrades. The model attends equally to stale intermediate outputs, abandoned threads, and retried phrasings as it does to your original goals and constraints.

This is the **garbage threshold**. It's currently invisible to users.

Claude OS makes it visible, measurable, and actionable.

---

## What it does

- **Instruments** Claude Code sessions via a `Stop` hook — captures input tokens, output tokens, cumulative context, latency, and stop reason per turn
- **Computes** a session-level context utilisation percentage in real time
- **Tracks** a quality proxy signal (output density, self-correction markers, turn-over-turn repetition) per turn
- **Plots** the efficiency curve per session — showing exactly where quality inflects
- **Surfaces** a four-state GC status: `Clean → Soft GC → Hard GC → Aged`
- **Organises** sessions by project topology — switch between a **By Project** tree and a flat **By Session** view, with per-project policy banners
- **Runs** policy-driven compaction — configurable triggers (turn cadence, context threshold, semantic classifiers) distil turns into structured memory files under `~/.claude/projects/<cwd>/claude-os/memory/`

---

## Design principle: context minimalism, across the session boundary

Anthropic's guidance for working with Claude is **context minimalism** — the smallest set of high-signal tokens that maximizes the likelihood of the right outcome. Claude OS is built to serve that principle, not fight it. The distinction that makes a *memory system* compatible with minimalism:

> Context minimalism constrains the **working context of a single inference** — the tokens competing for attention. It does not constrain what you persist on disk. **Storage is free; context is expensive.**

So the layers of this system divide cleanly. Compacting a session into typed files on disk costs the model zero attention — it's distillation, not loading. Eviction and token budgets *bound* the store, keeping retrieval cheap. The only operation that spends the attention budget is **seeding** memory into a new session — so that is the only place held to a strict minimalist standard: Claude OS seeds a thin **index** of what durable knowledge exists and lets the model pull the bodies just-in-time, rather than force-loading everything at session start.

This is also why Claude OS is **complementary to native compaction, not a competitor.** Native compaction minimizes context *within* a session, under duress near the limit, and discards the result when the session ends. Claude OS minimizes the context a *new* session inherits — across a boundary the model is structurally blind to, with the result persisted, bounded, and observable. The litmus test we hold ourselves to: *a session with memory must reach productive work in fewer tokens than the same session cold-started.* If memory doesn't pay for itself, it's a preamble tax — and we measure it.

> Full lifecycle design: [`docs/specs/spec-memory-eviction-lifecycle.md`](./docs/specs/spec-memory-eviction-lifecycle.md).

---

## GC State Machine

| State | Condition | Action |
|---|---|---|
| **Clean** | ctx < 60% | Continue normally |
| **Soft GC** | ctx 60–80% | Summarise thread, compact before continuing |
| **Hard GC** | ctx > 80% | Fork session — new session seeded with distilled context |
| **Aged** | Closed, unresolved | Archive to persistent memory / `CLAUDE.md` |

Transitions are one-way within a session. A forked session starts Clean.

---

## Architecture

```
claude-os/
├── packages/
│   ├── core/          TypeScript ingestion, SQLite schema, DB access layer
│   ├── server/        Hono API server (localhost:7842)
│   └── mcp/           MCP server — Claude reads its own context health
├── apps/
│   ├── desktop/       Electron + React activity monitor window
│   └── menu-bar/      Swift + AppKit menu bar sprite
├── scripts/           Bulk ingest, export, and Claude Code hook
├── analysis/          Phase 0 notebooks — efficiency curve empirics
└── docs/              Architecture, compaction templates, research notes
```

### Stack

| Layer | Choice |
|---|---|
| Runtime | Bun |
| Session capture | Claude Code hooks (JSONL transcripts) |
| Local store | SQLite via `better-sqlite3` + Drizzle ORM |
| Local server | Hono |
| Menu bar | Swift + AppKit (`NSStatusItem`) |
| Main window | Electron + React + Vite |
| Charts | Recharts |
| State | Zustand |
| Compaction LLM | Claude Sonnet |
| MCP server | `@modelcontextprotocol/sdk` |

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

**3. Start the activity monitor**

```bash
bun run dev
```

This runs four processes concurrently — Hono API server (`:7842`), Vite renderer (`:5173`), TypeScript watch, and Electron. The tray icon appears in your macOS menu bar; left-click to open the activity monitor window.

**Verify the server is up:**

```bash
curl http://localhost:7842/health
# {"status":"ok","version":"0.1.0"}
```

See [RUNBOOK.md](./RUNBOOK.md) for troubleshooting, environment variables, and TypeScript conventions.

---

## Database schema

```sql
sessions(id, name, model, ctx_window, created_at, status, outcome_status)

turns(
  id, session_id, turn_index,
  input_tokens, output_tokens, cumulative_tokens,
  ctx_pct, latency_ms, stop_reason, created_at
)

gc_events(id, session_id, gc_type, ctx_pct_at_trigger, created_at)

outcomes(id, session_id, label, resolved, resolved_at)
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

### Phase 3 — Compaction Engine `← current`
- [ ] One-click Compact & Fork action
- [ ] Smart compaction prompt templates per project type
- [ ] Persistent memory export → markdown / `CLAUDE.md` append

### Phase 4 — Outcomes Layer
- [ ] User-configurable outcome definitions per session type
- [ ] Cost-per-outcome reporting (API spend / resolved outcomes)
- [ ] Stalled session detection + escalation

### Phase 5 — Public Release
- [ ] MCP server — Claude reads its own context health in real time
- [ ] Empirical research write-up: efficiency curves across session types
- [ ] `brew install claude-os`

---

## Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md) for code style, commit conventions, and how to open a PR.

Phase 3 is the active work surface. The most useful contributions right now:

- **Compaction prompt templates** — project-type-aware prompts that produce good `CLAUDE.md` seeds
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

*Built in Toronto. Phase 3 — June 2026.*