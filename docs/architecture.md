# Architecture

See the project document for full context. This file tracks decisions that diverge from or extend the original spec.

## Decision log

### 2026-06 — Bun over Node
Chose Bun as the runtime for `packages/core` and `packages/server`. Native SQLite support, faster cold starts, zero build config for TypeScript. The menu bar (Swift) and Electron app are unaffected.

### 2026-06 — Drizzle over raw SQL for queries
Raw SQL for schema migrations (simpler, more explicit). Drizzle for typed query helpers in `db.ts`. No ORM magic — just typed wrappers over `better-sqlite3`.

### 2026-06 — Hono over Express
Smaller, typed, edge-ready if we ever want to expose session health remotely. Port 7842 is arbitrary and chosen to avoid conflicts with common dev servers.
