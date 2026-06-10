# Claude OS

> A macOS activity monitor for Claude sessions. Real-time token economics, context window health, and GC state tracking — before quality degrades.

![Phase](https://img.shields.io/badge/phase-0%20%E2%80%94%20proof%20of%20concept-34c759?style=flat-square)
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

- **Instruments** every Claude API call — captures input tokens, output tokens, cumulative context, latency, and stop reason per turn
- **Computes** a session-level context utilisation percentage in real time
- **Tracks** a quality proxy signal (output density, latency, self-correction markers) per turn
- **Plots** the efficiency curve per session — showing exactly where quality inflects
- **Surfaces** a four-state GC status: `Clean → Soft GC → Hard GC → Aged`
- **Triggers** native macOS alerts when a session crosses a threshold
- **Enables** one-click Compact & Fork — auto-generates a structured context summary and seeds a new session

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
│   ├── core/          TypeScript instrumentation wrapper + SQLite schema
│   ├── server/        Hono local server (localhost:7842)
│   ├── app/           Electron + React activity monitor window
│   └── mcp/           MCP server — Claude reads its own context health
├── apps/
│   └── menu-bar/      Swift + AppKit menu bar sprite
├── analysis/          Phase 0 notebooks — efficiency curve empirics
├── site/              Splash page (served via GitHub Pages)
└── docs/              Architecture, compaction templates, research notes
```

### Stack

| Layer | Choice |
|---|---|
| Runtime | Bun |
| Instrumentation | TypeScript + Anthropic SDK |
| Local store | SQLite via `better-sqlite3` + Drizzle ORM |
| Local server | Hono |
| Menu bar | Swift + AppKit (`NSStatusItem`) |
| Main window | Electron + React + Vite |
| Charts | Recharts → D3 |
| State | Zustand |
| Compaction LLM | Claude Sonnet |
| MCP server | `@modelcontextprotocol/sdk` |

---

## Roadmap

### Phase 0 — Proof of Concept `← current`
- [ ] Anthropic Messages API wrapper — per-turn token capture
- [ ] Session-level context utilisation % in real time
- [ ] Quality proxy logging: output length, latency, self-correction rate
- [ ] SQLite store + post-hoc efficiency curve notebook
- [ ] Empirical identification of quality inflection point across 10–20 sessions

### Phase 1 — Menu Bar Sprite
- [ ] macOS menu bar app — Swift / AppKit `NSStatusItem`
- [ ] Real-time context depth indicator, colour-coded GC state
- [ ] Native `UNUserNotificationCenter` alerts at threshold crossings
- [ ] Configurable GC threshold (default: 80%)

### Phase 2 — Activity Monitor Window
- [ ] Full panel: sortable session list, live efficiency curve chart
- [ ] Electron + React, IPC to SQLite, macOS vibrancy
- [ ] Turn-by-turn token breakdown, GC event log

### Phase 3 — Compaction Engine
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

## Getting started

> Phase 0 is in active development. The instrumentation wrapper is not yet published. Instructions will be updated as each phase ships.

**Prerequisites**

- [Bun](https://bun.sh) ≥ 1.1
- An Anthropic API key

```bash
git clone https://github.com/TaiPanda96/claude-os.git
cd claude-os
bun install
```

**Run the instrumentation wrapper**

```bash
cd packages/core
cp .env.example .env        # add your ANTHROPIC_API_KEY
bun run src/wrapper.ts
```

**View the efficiency curve**

```bash
cd analysis
jupyter notebook efficiency_curve.ipynb
```

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

## Contributing

This project is in early research phase. If you're interested in contributing to the efficiency curve empirics (Phase 0) or have data on context quality degradation across session types, open an issue.

For everything else — bug reports, feature ideas, research notes — issues are open.

---

## Research context

Claude OS is being developed as both a practical tool and a research contribution — an empirical measurement of context efficiency as a user-facing primitive. The goal is to demonstrate that the garbage threshold is real, measurable, and actionable before it becomes a first-party feature.

---

## License

MIT © [Tai Lin](https://github.com/TaiPanda96)

---

*Built in Toronto. Phase 0 — June 2026.*
