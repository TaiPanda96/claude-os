# CLAUDE.md

macOS activity monitor for Claude Code sessions: instruments sessions via hooks, computes per-turn context utilisation + a quality proxy, surfaces a four-state GC machine, and (Phase 3+) runs policy-driven compaction. Product framing → `README.md`, setup/troubleshooting → `RUNBOOK.md`, data-flow diagrams → `ARCHITECTURE.md`.

## Commands

Bun (≥1.1) is the runtime; Electron main runs under Node (≥20). Run from repo root unless noted.

```bash
bun run typecheck     # root + every package — run before committing (no test suite yet)
bun run build         # core + server
bun run ingest        # one-shot ETL of ~/.claude/projects/ JSONL → SQLite (idempotent)
bun run dev           # desktop dev — but see the cwd gotcha below
```

**Desktop must run from `apps/desktop/`, not root** — `dist/main.js` resolution depends on cwd:

```bash
cd apps/desktop && bun run dev
```

Remaining scripts (`install`, `setup`, `ingest:stats`, `export`) are in root `package.json`; first-time setup is in `RUNBOOK.md`. Manual verification: `curl localhost:7842/health`.

## Architecture

Three TS packages + two apps around one SQLite file at repo root (gitignored). Full data-flow lives in `ARCHITECTURE.md`.

- **`packages/core`** — *the only package that touches the DB or the LLM.* Exports via `src/index.ts`. Key modules: `db.ts` (connection + schema migration + all queries), `types.ts` (domain types, threshold/model constants, policy types), `health.ts` (efficiency-curve stats), `ingest/`, `compaction.ts` + `trigger-evaluator.ts`.
- **`packages/server`** — thin Hono read + policy/compaction API, single `src/index.ts`. CORS origins are hardcoded here; a new frontend origin means editing that list.
- **`apps/desktop`** — Electron main (`src/main.ts`) + React/Recharts renderer. Talks to the server over HTTP, never to SQLite directly.

DB path: `CLAUDE_OS_DB_PATH` env var, else repo-root `claude-os.sqlite`. `getDb()` is a singleton and runs migration on first call.

### Invariants worth not breaking

- **The per-turn quality formula is duplicated in `packages/core/src/health.ts` (`qualityForTurn`) and `apps/desktop/src/renderer/quality.ts` — change both together.** A comment marks it in `health.ts`. Divergence is silent.
- Ingest (live hook + bulk) funnels through `ingestJsonLFile` and writes `INSERT OR IGNORE` — idempotent, safe to re-run.
- `scripts/hook-stop.ts` runs on every turn and **Claude Code blocks on it before returning control** — so it must stay fast, silent, do no network I/O, and exit 0 unconditionally.
- Single-source-of-truth constants — GC thresholds (`GC_THRESHOLDS`), context windows (`MODEL_CONTEXT_WINDOWS`) in `types.ts`; compaction model selection in `compaction.ts`/`trigger-evaluator.ts`. Reference these by name; never copy their values into docs or other code.
- Compaction requires `ANTHROPIC_API_KEY` (`packages/core/.env`).

## Conventions

- TS strict (`tsconfig.base.json`, incl. `exactOptionalPropertyTypes` + `noUncheckedIndexedAccess`). No `any`; no `as` cast without a comment saying why. Comments explain *why*, not *what*.
- Relative TS imports use `.js` extensions (NodeNext). `apps/desktop` is the one package on `node16` module resolution (Electron's Node main); all others use Bun's tsconfig.
- Commit style: `type(scope): description` — `feat|fix|chore|docs|refactor|test` × `core|server|app|menu-bar|analysis|site`. One logical change per PR.
- **Never commit** `.env`, `*.sqlite*` (incl. `-wal`/`-shm`), or `claude-os/memory/`.