import { Hono } from "hono";
import { cors } from "hono/cors";
import { getDb, getSession, getSessionTurns, computeSessionHealthStats } from "@claude-os/core";

/**
 * The main server entry point for the Claude OS application. This server provides API endpoints for managing sessions, turns, and garbage collection events.
 * It uses the Hono framework for handling HTTP requests and responses, and it interacts with a SQLite database to store and retrieve session data.
 * The server listens on port 7842 and allows cross-origin requests from the specified origins.
 */
const app = new Hono();
const PORT = 7842;

app.use("/*", cors({ origin: ["http://localhost:3000", "http://localhost:5173", "app://claude-os"] }));

app.get("/health", (c) => c.json({ status: "ok", version: "0.1.0" }));

app.get("/sessions", (c) => {
  const db = getDb();
  const sessions = db
    .prepare(
      `
    SELECT s.*,
      (SELECT ctx_pct FROM turns WHERE session_id = s.id ORDER BY turn_index DESC LIMIT 1) as current_ctx_pct,
      (SELECT COUNT(*) FROM turns WHERE session_id = s.id) as turn_count
    FROM sessions s
    ORDER BY last_active_at DESC
  `,
    )
    .all();
  return c.json(sessions);
});

app.get("/sessions/:id", (c) => {
  const db = getDb();
  const session = getSession(db, c.req.param("id"));
  if (!session) return c.json({ error: "not found" }, 404);
  const turns = getSessionTurns(db, session.id);
  return c.json({ session, turns });
});

app.get("/sessions/:id/health", (c) => {
  const db = getDb();
  const session = getSession(db, c.req.param("id"));
  if (!session) return c.json({ error: "not found" }, 404);
  const turns = getSessionTurns(db, session.id);
  const stats = computeSessionHealthStats(turns);
  return c.json(stats);
});

app.get("/sessions/:id/gc-events", (c) => {
  const db = getDb();
  const events = db
    .prepare(
      `
    SELECT * FROM gc_events WHERE session_id = $sessionId ORDER BY created_at ASC
  `,
    )
    .all({ $sessionId: c.req.param("id") });
  return c.json(events);
});

export default { port: PORT, fetch: app.fetch };
