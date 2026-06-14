import { Hono } from "hono";
import { cors } from "hono/cors";
import { v4 as uuidv4 } from "uuid";
import {
  getDb,
  getSession,
  getSessionTurns,
  computeSessionHealthStats,
  getPolicy,
  upsertPolicy,
  getCompactionEvents,
  compaction,
  TriggerTypeEnum,
} from "@claude-os/core";
import type { CompactionPolicy } from "@claude-os/core";

/**
 * The main server entry point for the Claude OS application. This server provides API endpoints for managing sessions, turns, and garbage collection events.
 * It uses the Hono framework for handling HTTP requests and responses, and it interacts with a SQLite database to store and retrieve session data.
 * The server listens on port 7842 and allows cross-origin requests from the specified origins.
 */
const app = new Hono();
const PORT = 7842;

app.use(
  "/*",
  cors({
    origin: [
      "http://localhost:3000",
      "http://localhost:5173",
      "app://claude-os",
    ],
  }),
);

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

// ── Policy management ─────────────────────────────────────────────────────────

app.get("/projects/:id/policy", (c) => {
  const db = getDb();
  const policy = getPolicy(db, c.req.param("id"));
  if (!policy) return c.json({ error: "no policy configured" }, 404);
  return c.json(policy);
});

app.put("/projects/:id/policy", async (c) => {
  const db = getDb();
  const projectId = c.req.param("id");
  const body = (await c.req.json()) as Omit<
    CompactionPolicy,
    "id" | "project_id" | "created_at" | "updated_at"
  >;
  const existing = getPolicy(db, projectId);
  const now = new Date().toISOString();
  const policy: CompactionPolicy = {
    id: existing?.id ?? uuidv4(),
    project_id: projectId,
    created_at: existing?.created_at ?? now,
    updated_at: now,
    ...body,
  };
  upsertPolicy(db, policy);
  return c.json(policy);
});

// ── Compaction history ────────────────────────────────────────────────────────

app.get("/sessions/:id/compaction-events", (c) => {
  const db = getDb();
  const events = getCompactionEvents(db, c.req.param("id"));
  return c.json(events);
});

// ── Manual compaction ─────────────────────────────────────────────────────────

app.post("/sessions/:id/compact", async (c) => {
  const db = getDb();
  const sessionId = c.req.param("id");
  const session = getSession(db, sessionId);
  if (!session) return c.json({ error: "session not found" }, 404);
  if (!session.projectId)
    return c.json({ error: "session has no project" }, 400);

  const policy = getPolicy(db, session.projectId);
  if (!policy || !policy.active)
    return c.json({ error: "no active policy for this project" }, 400);

  const turns = getSessionTurns(db, sessionId);
  const lastTurn = turns[turns.length - 1];
  if (!turns.length || !lastTurn)
    return c.json({ error: "no turns in session" }, 400);

  // Run in background, return immediately with event id
  const eventPromise = compaction(
    db,
    sessionId,
    policy,
    TriggerTypeEnum.MANUAL,
    "manual compaction",
    lastTurn.cumulativeTokens,
    (session as any).cwd ?? "",
  );

  // Fire and forget — client polls /compaction-events for result
  eventPromise.catch((err: unknown) => console.error("[compact]", err));

  return c.json({
    status: "started",
    session_id: sessionId,
    policy_id: policy.id,
  });
});

export default { port: PORT, fetch: app.fetch };
