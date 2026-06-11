# Claude OS — Runbook

Practical guide for getting Claude OS running locally, from first clone to live activity monitor.

---

## Prerequisites

- [Bun](https://bun.sh) ≥ 1.1 — used for the runtime, server, and scripts
- [Node.js](https://nodejs.org) ≥ 20 — used by Electron's main process
- macOS — Electron tray icon and notifications are macOS-only
- Claude Code CLI installed and active (hooks must be wired to populate the database)

---

## 1. Install dependencies

```bash
git clone https://github.com/TaiPanda96/claude-os.git
cd claude-os
bun install
```

This installs across all workspaces: `packages/core`, `packages/server`, and `apps/desktop`.

---

## 2. Wire the Claude Code hooks

Claude OS captures session data via Claude Code's `stop` hook. Add the following to your `~/.claude/settings.json`:

```json
{
  "hooks": {
    "Stop": [
      {
        "matcher": "",
        "hooks": [
          {
            "type": "command",
            "command": "bun run /path/to/claude-os/scripts/hook-stop.ts"
          }
        ]
      }
    ]
  }
}
```

Replace `/path/to/claude-os` with the absolute path to your clone. After this, every Claude Code session that ends writes its turn data to `claude-os.sqlite` at the repo root.

---

## 3. Populate the database (bulk ingest)

If you have existing Claude Code sessions you want to analyse, run the bulk ingest against your local JSONL transcript files:

```bash
bun run ingest
```

This scans `~/.claude/projects/` for all JSONL transcripts and writes sessions and turns to `claude-os.sqlite`.

To export sessions as JSON for the analysis notebook:

```bash
bun run export
```

Output lands in `analysis/sessions/`.

---

## 4. Start the desktop app

```bash
cd apps/desktop
bun run dev
```

This runs four processes concurrently:

| Label | Process | Port |
|---|---|---|
| `[server]` | Hono API server (Bun) | 7842 |
| `[vite]` | React renderer dev server | 5173 |
| `[tsc]` | TypeScript watch compiler | — |
| `[electron]` | Electron main process | — |

The tray icon appears in your macOS menu bar. Left-click it to open the Activity Monitor window.

### What you should see on a clean start

```
[server] Started development server: http://localhost:7842
[tsc]    Starting compilation in watch mode...
[vite]   VITE ready in ~300ms — Local: http://localhost:5173/
[tsc]    Found 0 errors. Watching for file changes.
[electron] (window opens after ~2s)
```

---

## 5. Verify the server

```bash
curl http://localhost:7842/health
# {"status":"ok","version":"0.1.0"}

curl http://localhost:7842/sessions
# [...array of session rows...]
```

---

## Common issues

### Two processes on port 7842

```bash
lsof -ti :7842 | xargs kill -9
```

Root cause is usually a stale process from a previous `bun run dev` that wasn't cleanly killed. Restart `bun run dev` after clearing the port.

### Electron window shows "Failed to fetch"

Two possible causes:

1. **Server not yet started** — the Electron window opened before the Hono server was ready. Click Retry in the window, or wait for the next 5-second poll.

2. **Stale `dist/main.js`** — the compiled Electron entry is out of date. The dev script runs `tsc -p tsconfig.json` before starting `concurrently`, so this should be caught. If it persists, delete `apps/desktop/dist/` and re-run `bun run dev`.

### `dist/main.js` emits alongside `src/main.ts`

This was caused by `rootDir` being set to a file path instead of a directory in `apps/desktop/tsconfig.json`. It is fixed. If you see `.js` files in `src/`, delete them — `dist/` is the correct output location.

### Port not reachable from the renderer

The Hono CORS config must include `http://localhost:5173`. Check `packages/server/src/index.ts`:

```typescript
app.use("/*", cors({ origin: ["http://localhost:3000", "http://localhost:5173", "app://claude-os"] }));
```

If you add a new origin (e.g. a web dashboard), add it here and restart the server.

### Tray icon appears and immediately disappears

Electron is likely failing to load `dist/main.js`. Check that:

- `bun run dev` is run from `apps/desktop/`, not the repo root
- `dist/main.js` exists and was compiled after the last change to `src/main.ts`
- No unhandled exception in the Electron main process (check terminal output for `[electron]` errors)

---

## Key paths

| Path | Purpose |
|---|---|
| `claude-os.sqlite` | SQLite database — repo root, never committed |
| `packages/core/src/` | Ingestion logic, schema, DB access |
| `packages/server/src/index.ts` | Hono API server entry |
| `apps/desktop/src/main.ts` | Electron main process |
| `apps/desktop/src/renderer/` | React activity monitor UI |
| `scripts/hook-stop.ts` | Claude Code stop hook |
| `scripts/ingest.ts` | Bulk JSONL ingest |
| `analysis/` | Phase 0 notebooks and session exports |

---

## TypeScript conventions

This repo uses Bun's recommended tsconfig for all packages:

```json
{
  "module": "preserve",
  "moduleResolution": "bundler",
  "types": ["bun"]
}
```

**Exception:** `apps/desktop/tsconfig.json` uses `module: "node16"` and `moduleResolution: "node16"` because Electron's main process runs under Node.js, not Bun.

Run the full typecheck across all packages:

```bash
bun run typecheck
```
