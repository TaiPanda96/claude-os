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

**Migration pattern** (`packages/core/src/db/migrate.ts`): a `migrations` table tracks each applied migration by numeric id. On startup, `migrateDb` runs only the entries absent from that table — in order, each in its own transaction. To add a migration, append one entry to the `MIGRATIONS` array. No version counters, no if/else chains, no try/catch guards for pre-existing columns.

### Invariants worth not breaking

- **Quality/health logic has one home each — don't re-inline it.** The per-turn quality formula lives in `packages/core/src/domain/quality-proxy.ts` (`qualityForTurn`); the session-level degradation stats (peak/inflection/trend/turnsToInflection) live in `packages/core/src/domain/session-trend.ts` (`computeSessionTrend`). Both `health.ts` (server) and `apps/desktop/src/renderer/quality.ts` (renderer) import from these — keep it that way so the two sides can't silently diverge across the wire.
- Ingest (live hook + bulk) funnels through `ingestJsonLFile` and writes `INSERT OR IGNORE` — idempotent, safe to re-run.
- `scripts/hook-stop.ts` runs on every turn and **Claude Code blocks on it before returning control** — so it must stay fast, silent, do no network I/O, and exit 0 unconditionally.
- Single-source-of-truth constants — GC thresholds (`GC_THRESHOLDS`), context windows (`MODEL_CONTEXT_WINDOWS`) in `types.ts`; compaction model selection in `compaction.ts`/`trigger-evaluator.ts`. Reference these by name; never copy their values into docs or other code.
- Compaction requires `ANTHROPIC_API_KEY` (`packages/core/.env`).

## Conventions
- JS doc strings on functions & classes
- Keep domain/business logic pure, isolate side effects with `io` (e.g - `create-turn-io.ts`)
- TS strict (`tsconfig.base.json`, incl. `exactOptionalPropertyTypes` + `noUncheckedIndexedAccess`). No `any`; no `as` cast without a comment saying why. Comments explain *why*, not *what*.
- Relative TS imports use `.js` extensions (NodeNext). `apps/desktop` is the one package on `node16` module resolution (Electron's Node main); all others use Bun's tsconfig.
- Commit style: `type(scope): description` — `feat|fix|chore|docs|refactor|test` × `core|server|app|menu-bar|analysis|site`. One logical change per PR.
- **Never commit** `.env`, `*.sqlite*` (incl. `-wal`/`-shm`), or `claude-os/memory/`.