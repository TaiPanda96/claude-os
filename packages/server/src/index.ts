import { Hono } from "hono";
import { cors } from "hono/cors";
import { getDb, getSession, getSessionTurns } from "@claude-os/core";

const app = new Hono();
const PORT = 7842;

app.use("/*", cors({ origin: ["http://localhost:3000", "app://claude-os"] }));

app.get("/health", (c) => c.json({ status: "ok", version: "0.1.0" }));

app.get("/sessions", (c) => {
  const db = getDb();
  const sessions = db.prepare(`
    SELECT s.*,
      (SELECT ctx_pct FROM turns WHERE session_id = s.id ORDER BY turn_index DESC LIMIT 1) as current_ctx_pct,
      (SELECT COUNT(*) FROM turns WHERE session_id = s.id) as turn_count
    FROM sessions s
    ORDER BY last_active_at DESC
  `).all();
  return c.json(sessions);
});

app.get("/sessions/:id", (c) => {
  const db = getDb();
  const session = getSession(db, c.req.param("id"));
  if (!session) return c.json({ error: "not found" }, 404);
  const turns = getSessionTurns(db, session.id);
  return c.json({ session, turns });
});

app.get("/sessions/:id/gc-events", (c) => {
  const db = getDb();
  const events = db.prepare(`
    SELECT * FROM gc_events WHERE session_id = ? ORDER BY created_at ASC
  `).all(c.req.param("id"));
  return c.json(events);
});

console.log(`Claude OS server running at http://localhost:${PORT}`);
export default { port: PORT, fetch: app.fetch };
