# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Claude OS is a macOS activity monitor for Claude Code sessions. It instruments sessions via Claude Code hooks, computes per-turn context utilisation and a quality proxy, surfaces a four-state GC machine (`Clean → Soft GC → Hard GC → Aged`), and (Phase 3+) runs policy-driven compaction that writes distilled memory files. See `README.md` for product framing, `RUNBOOK.md` for setup/troubleshooting, and `ARCHITECTURE.md` for the data-flow diagrams.

## Commands

Runtime is **Bun** (≥1.1); Electron's main process runs under **Node** (≥20). Run from the repo root unless noted.

```bash
bun install                 # install across all workspaces
bun run setup               # scripts/setup.ts — first-time setup
bun run typecheck           # typechecks root + every package (run this before committing)
bun run build               # builds core + server only

bun run dev                 # alias for apps/desktop dev (see below)
bun run ingest              # one-shot bulk ETL of ~/.claude/projects/ JSONL → SQLite
bun run ingest:stats        # ingest + print stats
bun run export              # export sessions to analysis/sessions/ as JSON
```

**Desktop app** — must be run from `apps/desktop/`, not the root (`dist/main.js` resolution depends on cwd):

```bash
cd apps/desktop && bun run dev
```

`dev` runs `tsc` once, then `concurrently` launches four labelled processes: `[server]` Hono on :7842, `[vite]` renderer on :5173, `[tsc]` watch compiler, `[electron]` main process (after a 2s sleep). There is no test suite yet — verification is the typecheck plus manual checks against `curl localhost:7842/health`.

## Architecture

Three TypeScript packages + two apps, wired around a single SQLite file at the repo root (`claude-os.sqlite`, gitignored).

```
scripts/hook-stop.ts   ─┐ live: Claude Code Stop hook, fires per turn
scripts/ingest.ts      ─┤ backfill: one-shot ETL of historical sessions
                        ▼
              claude-os.sqlite   ◄── packages/core (schema + ingest + health + compaction)
                        ▲
        packages/server (Hono :7842) ──► apps/desktop renderer (React + Recharts, polls every 5s)
```

- **`packages/core`** (`@claude-os/core`) — the only package that touches the DB and the LLM. Exports everything through `src/index.ts`. Key modules: `db.ts` (connection + schema migration + all queries), `types.ts` (domain types, `GC_THRESHOLDS`, `MODEL_CONTEXT_WINDOWS`, `TriggerTypeEnum`, policy types), `health.ts` (efficiency-curve stats), `ingest/` (JSONL parsing → turns), `compaction.ts` + `trigger-evaluator.ts` (Phase 3 engine).
- **`packages/server`** (`@claude-os/server`) — thin Hono read API + policy/compaction endpoints. Single file `src/index.ts`. CORS origins are hardcoded there; adding a new frontend origin means editing that list.
- **`apps/desktop`** (`@claude-os/desktop`) — Electron main (`src/main.ts`) + React renderer (`src/renderer/`). The tray icon opens the Activity Monitor window. Talks to the server over HTTP, not directly to SQLite.
- **`scripts/`** — `hook-stop.ts` (the live feed), `ingest.ts` (backfill), `export.ts`, `setup.ts`.

### Data ingestion model

Both the hook and the bulk ingest funnel through `ingestJsonLFile` in `packages/core/src/ingest/`. It pairs user/assistant records from `~/.claude/projects/<project>/<session>.jsonl`, computes per-turn metrics, and writes with `INSERT OR IGNORE` (idempotent — safe to re-run). `hook-stop.ts` must stay fast, silent, and do no network I/O — Claude Code blocks on it before returning control, so it exits 0 unconditionally. Wiring it requires a `Stop` hook entry in `~/.claude/settings.json` pointing at its absolute path (see RUNBOOK).

### GC state & quality proxy

`computeGCState(ctxPct)` in `types.ts` maps context fraction to state via `GC_THRESHOLDS` (soft 0.6, hard 0.8). The per-turn quality proxy combines `outputDensity`, `selfCorrectionCount` (matched against `SELF_CORRECTION_MARKERS`), and `repetitionScore` (bigram overlap with the prior turn).

> ⚠️ The quality formula and its anchor constants are duplicated in **two** places that must stay in sync: `packages/core/src/health.ts` (`qualityForTurn`, server-side stats) and `apps/desktop/src/renderer/quality.ts` (renderer). Change both together — there's a comment marking this in `health.ts`.

### Compaction engine (Phase 3, current work surface)

`trigger-evaluator.ts` is called fire-and-forget after each turn. It resolves the session's project → `CompactionPolicy`, enforces a cooldown, and evaluates `TriggerConfig`s (turn cadence, ctx threshold, semantic classifiers via a Haiku call, or combined). On fire it calls `runCompaction` (`compaction.ts`), which assembles a turn slice and writes per-`MemoryFile` outputs (`overwrite`/`append`/`merge` modes) into `~/.claude/projects/<encoded-cwd>/claude-os/memory/`. Models: classifier + extraction use `claude-haiku-4-5-20251001`, merge uses `claude-sonnet-4-6`. Requires `ANTHROPIC_API_KEY` (in `packages/core/.env`).

## Conventions

- **TypeScript strict** (`tsconfig.base.json`): `exactOptionalPropertyTypes`, `noUncheckedIndexedAccess`. No `any`, no `as` casts without a comment explaining why. Comments explain *why*, not *what*.
- All packages use Bun's tsconfig (`module: "preserve"`, `moduleResolution: "bundler"`, `types: ["bun"]`). **Exception:** `apps/desktop/tsconfig.json` uses `module/moduleResolution: "node16"` because Electron's main runs under Node.
- Imports use `.js` extensions on relative TS paths (NodeNext-style), matching the existing code.
- DB path resolves from `CLAUDE_OS_DB_PATH` env var, else the repo-root `claude-os.sqlite`. `getDb()` is a singleton and runs schema migration on first call.
- Commit style: `type(scope): description` — types `feat|fix|chore|docs|refactor|test`, scopes `core|server|app|menu-bar|analysis|site`. One logical change per PR.
