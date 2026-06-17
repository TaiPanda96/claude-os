import { Hono } from "hono";
import { cors } from "hono/cors";
import { streamSSE } from "hono/streaming";
import { v4 as uuidv4 } from "uuid";
import {
  getDb,
  getSession,
  getSessionTurns,
  computeSessionHealthStats,
  getPolicy,
  upsertPolicy,
  getCompactionEvents,
  getLastCompactionEvent,
  upsertSession,
  compaction,
  TriggerTypeEnum,
  computeCostUsd,
  getPricing,
} from "@claude-os/core";
import type { CompactionPolicy, CompactionLifecycleEvent } from "@claude-os/core";
import { publish, subscribe, inProcessEventSink } from "./compaction-event-bus.js";

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

app.get("/projects", (c) => {
  const db = getDb();
  const projects = db
    .prepare(
      `SELECT p.*,
        COUNT(s.id) as session_count,
        MAX(s.last_active_at) as last_active_at,
        (cp.id IS NOT NULL) as has_policy,
        cp.name   as policy_name,
        cp.active as policy_active
       FROM projects p
       LEFT JOIN sessions s ON s.project_id = p.id
       LEFT JOIN compaction_policies cp ON cp.project_id = p.id
       GROUP BY p.id
       ORDER BY last_active_at DESC`,
    )
    .all();
  return c.json(projects);
});

app.get("/sessions", (c) => {
  const db = getDb();
  const sinceDays = Number(c.req.query("since_days") ?? "7");
  const since = sinceDays > 0 ? Date.now() - sinceDays * 86_400_000 : 0;
  const sessions = db
    .prepare(
      `SELECT s.*,
        p.id   as project_id,
        p.name as project_name,
        (SELECT ctx_pct FROM turns WHERE session_id = s.id ORDER BY turn_index DESC LIMIT 1) as current_ctx_pct,
        (SELECT COUNT(*) FROM turns WHERE session_id = s.id) as turn_count
       FROM sessions s
       LEFT JOIN projects p ON p.id = s.project_id
       WHERE s.last_active_at >= $since
       ORDER BY s.last_active_at DESC`,
    )
    .all({ $since: since });
  return c.json(sessions);
});

app.get("/sessions/:id", (c) => {
  const db = getDb();
  const session = getSession(db, c.req.param("id"));
  if (!session) return c.json({ error: "not found" }, 404);
  const turns = getSessionTurns(db, session.id);
  const forks = (
    db
      .prepare(`SELECT id FROM sessions WHERE forked_from = $parentId`)
      .all({ $parentId: session.id }) as { id: string }[]
  ).map((r) => r.id);
  const lastCompaction = getLastCompactionEvent(db, session.id);
  return c.json({ session, turns, forks, lastCompaction: lastCompaction ?? null });
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

// ── Spend endpoints ───────────────────────────────────────────────────────────

app.get("/spend/daily", (c) => {
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT
        date(t.created_at / 1000, 'unixepoch', 'localtime') AS day,
        s.model,
        SUM(t.input_tokens)           AS input_tokens,
        SUM(t.output_tokens)          AS output_tokens,
        SUM(t.cache_read_tokens)      AS cache_read_tokens,
        SUM(t.cache_creation_tokens)  AS cache_creation_tokens
       FROM turns t
       JOIN sessions s ON s.id = t.session_id
       GROUP BY day, s.model
       ORDER BY day DESC`,
    )
    .all() as Array<{
    day: string;
    model: string;
    input_tokens: number;
    output_tokens: number;
    cache_read_tokens: number;
    cache_creation_tokens: number;
  }>;

  const annotated = rows.map((r) => {
    const { pricing, fallback } = getPricing(r.model);
    return {
      ...r,
      cost_usd: computeCostUsd(
        pricing,
        r.input_tokens,
        r.output_tokens,
        r.cache_read_tokens,
        r.cache_creation_tokens,
      ),
      pricing_fallback: fallback,
    };
  });

  return c.json(annotated);
});

app.get("/spend/sessions", (c) => {
  const db = getDb();
  const sinceDays = Number(c.req.query("since_days") ?? "30");
  const since = sinceDays > 0 ? Date.now() - sinceDays * 86_400_000 : 0;

  const rows = db
    .prepare(
      `SELECT
        s.id,
        s.name,
        s.model,
        s.last_active_at,
        SUM(t.input_tokens)           AS input_tokens,
        SUM(t.output_tokens)          AS output_tokens,
        SUM(t.cache_read_tokens)      AS cache_read_tokens,
        SUM(t.cache_creation_tokens)  AS cache_creation_tokens
       FROM sessions s
       JOIN turns t ON t.session_id = s.id
       WHERE s.last_active_at >= $since
       GROUP BY s.id
       ORDER BY s.last_active_at DESC`,
    )
    .all({ $since: since }) as Array<{
    id: string;
    name: string | null;
    model: string;
    last_active_at: number;
    input_tokens: number;
    output_tokens: number;
    cache_read_tokens: number;
    cache_creation_tokens: number;
  }>;

  const annotated = rows.map((r) => {
    const { pricing, fallback } = getPricing(r.model);
    return {
      ...r,
      cost_usd: computeCostUsd(
        pricing,
        r.input_tokens,
        r.output_tokens,
        r.cache_read_tokens,
        r.cache_creation_tokens,
      ),
      pricing_fallback: fallback,
    };
  });

  return c.json(annotated);
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

// ── Compaction lifecycle events (webhook ingest + SSE fan-out) ─────────────────

// Out-of-process producers (the instrumented client's HttpEventSink) POST lifecycle
// events here. We log + broadcast them; there is no persistence by design — the
// compaction_events table remains the durable audit trail.
app.post("/webhooks/compaction", async (c) => {
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "invalid JSON" }, 400);
  }

  const event = body as Partial<CompactionLifecycleEvent>;
  const allowedTypes = new Set<CompactionLifecycleEvent["type"]>([
    "compaction.triggered",
    "compaction.started",
    "compaction.file_written",
    "compaction.completed",
    "compaction.failed",
  ]);

  if (
    !event ||
    typeof event.type !== "string" ||
    !allowedTypes.has(event.type as CompactionLifecycleEvent["type"]) ||
    typeof event.eventId !== "string" ||
    typeof event.sessionId !== "string" ||
    typeof event.at !== "string"
  ) {
    return c.json({ error: "invalid lifecycle event" }, 400);
  }

  publish(event as CompactionLifecycleEvent);
  return c.body(null, 202);
});

// Live stream of compaction lifecycle events for the desktop UI. Each event is sent as a
// named SSE event (its `type`), so the renderer can switch on it without parsing first.
app.get("/events", (c) =>
  streamSSE(c, async (stream) => {
    const unsubscribe = subscribe((event) => {
      void stream
        .writeSSE({ event: event.type, data: JSON.stringify(event) })
        .catch(() => {
          /* ignore: client may have disconnected */
        });
    });

    stream.onAbort(unsubscribe);

    try {
      // Heartbeat keeps the connection from being reaped while idle; loop exits on abort.
      while (!stream.aborted) {
        await stream.writeSSE({ event: "ping", data: "{}" });
        await stream.sleep(15_000);
      }
    } finally {
      unsubscribe();
    }
  }),
);

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

  // Run in background, return immediately with event id. In-process sink broadcasts the
  // lifecycle stream straight to SSE subscribers (no HTTP round-trip needed here).
  const eventPromise = compaction(
    db,
    sessionId,
    policy,
    TriggerTypeEnum.MANUAL,
    "manual compaction",
    lastTurn.cumulativeTokens,
    (session as any).cwd ?? "",
    undefined,
    inProcessEventSink,
  );

  // Fire and forget — client polls /compaction-events for result
  eventPromise.catch((err: unknown) => console.error("[compact]", err));

  return c.json({
    status: "started",
    session_id: sessionId,
    policy_id: policy.id,
  });
});

app.post("/sessions/:id/fork", async (c) => {
  const db = getDb();
  const parentId = c.req.param("id");
  const parent = getSession(db, parentId);
  if (!parent) return c.json({ error: "session not found" }, 404);

  let body: { name?: string } = {};
  try {
    body = await c.req.json();
  } catch {
    /* body is optional */
  }

  const now = Date.now();
  const child = {
    id: uuidv4(),
    name: body.name ?? (parent.name ? `${parent.name} (fork)` : null),
    model: parent.model,
    ctxWindow: parent.ctxWindow,
    createdAt: now,
    lastActiveAt: now,
    status: "active" as const,
    outcomeStatus: "unresolved" as const,
    forkedFrom: parentId,
    projectId: parent.projectId,
  };

  upsertSession(db, child);
  return c.json({ id: child.id, name: child.name, forked_from: parentId }, 201);
});

// Bind to loopback only — this API is unauthenticated and serves full session
// transcripts plus key-spending compaction endpoints. Without an explicit
// hostname, Bun.serve listens on 0.0.0.0 (all interfaces), exposing it to the
// local network. The Electron app talks to http://localhost:7842, so 127.0.0.1
// is sufficient.
export default { port: PORT, hostname: "127.0.0.1", fetch: app.fetch };
