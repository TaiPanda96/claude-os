import { join, basename } from "node:path";
import { Database } from "bun:sqlite";
import { v4 as uuidv4 } from "uuid";
import type {
  Session,
  Turn,
  GCEvent,
  Project,
  CompactionPolicy,
  CompactionEvent,
  CompactionFileResult,
} from "./types.js";
import { TriggerTypeEnum } from "./types.js";

export type { Database };

let _db: Database | null = null;

export function getDb(dbPath?: string): Database {
  if (_db) return _db;
  const resolved =
    dbPath ??
    process.env.CLAUDE_OS_DB_PATH ??
    join(import.meta.dir, "../../../claude-os.sqlite");
  _db = new Database(resolved);
  _db.run("PRAGMA journal_mode = WAL");
  _db.run("PRAGMA foreign_keys = ON");
  migrate(_db);
  return _db;
}

function migrate(db: Database): void {
  db.run(`
    CREATE TABLE IF NOT EXISTS sessions (
      id             TEXT PRIMARY KEY,
      name           TEXT,
      model          TEXT NOT NULL,
      ctx_window     INTEGER NOT NULL,
      created_at     INTEGER NOT NULL,
      last_active_at INTEGER NOT NULL,
      status         TEXT NOT NULL DEFAULT 'active',
      outcome_status TEXT NOT NULL DEFAULT 'unresolved',
      forked_from    TEXT REFERENCES sessions(id)
    )
  `);
  db.run(`
    CREATE TABLE IF NOT EXISTS turns (
      id                    TEXT PRIMARY KEY,
      session_id            TEXT NOT NULL REFERENCES sessions(id),
      turn_index            INTEGER NOT NULL,
      input_tokens          INTEGER NOT NULL,
      output_tokens         INTEGER NOT NULL,
      cumulative_tokens     INTEGER NOT NULL,
      ctx_pct               REAL NOT NULL,
      latency_ms            INTEGER NOT NULL,
      stop_reason           TEXT,
      created_at            INTEGER NOT NULL,
      self_correction_count INTEGER NOT NULL DEFAULT 0,
      repetition_score      REAL NOT NULL DEFAULT 0,
      output_density        REAL NOT NULL DEFAULT 0
    )
  `);
  db.run(`
    CREATE TABLE IF NOT EXISTS gc_events (
      id                 TEXT PRIMARY KEY,
      session_id         TEXT NOT NULL REFERENCES sessions(id),
      gc_type            TEXT NOT NULL,
      ctx_pct_at_trigger REAL NOT NULL,
      created_at         INTEGER NOT NULL
    )
  `);
  db.run(`
    CREATE TABLE IF NOT EXISTS outcomes (
      id          TEXT PRIMARY KEY,
      session_id  TEXT NOT NULL REFERENCES sessions(id),
      label       TEXT NOT NULL,
      resolved    INTEGER NOT NULL DEFAULT 0,
      resolved_at INTEGER
    )
  `);
  db.run(`CREATE INDEX IF NOT EXISTS idx_turns_session ON turns(session_id)`);
  db.run(
    `CREATE INDEX IF NOT EXISTS idx_gc_events_session ON gc_events(session_id)`,
  );
  db.run(
    `CREATE INDEX IF NOT EXISTS idx_outcomes_session ON outcomes(session_id)`,
  );
}

export function insertSession(db: Database, s: Session): void {
  db.prepare(
    `INSERT INTO sessions (id, name, model, ctx_window, created_at, last_active_at, status, outcome_status, forked_from, project_id)
     VALUES ($id, $name, $model, $ctxWindow, $createdAt, $lastActiveAt, $status, $outcomeStatus, $forkedFrom, $projectId)`,
  ).run({
    $id: s.id,
    $name: s.name,
    $model: s.model,
    $ctxWindow: s.ctxWindow,
    $createdAt: s.createdAt,
    $lastActiveAt: s.lastActiveAt,
    $status: s.status,
    $outcomeStatus: s.outcomeStatus,
    $forkedFrom: s.forkedFrom,
    $projectId: s.projectId ?? null,
  });
}

/** Idempotent session write — safe from both the live wrapper and the backfill ingest. */
export function upsertSession(db: Database, s: Session): void {
  db.prepare(
    `INSERT INTO sessions (id, name, model, ctx_window, created_at, last_active_at, status, outcome_status, forked_from, project_id)
     VALUES ($id, $name, $model, $ctxWindow, $createdAt, $lastActiveAt, $status, $outcomeStatus, $forkedFrom, $projectId)
     ON CONFLICT(id) DO UPDATE SET
       last_active_at = excluded.last_active_at,
       model          = excluded.model,
       project_id     = COALESCE(excluded.project_id, project_id)`,
  ).run({
    $id: s.id,
    $name: s.name,
    $model: s.model,
    $ctxWindow: s.ctxWindow,
    $createdAt: s.createdAt,
    $lastActiveAt: s.lastActiveAt,
    $status: s.status,
    $outcomeStatus: s.outcomeStatus,
    $forkedFrom: s.forkedFrom,
    $projectId: s.projectId ?? null,
  });
}

export function insertTurn(db: Database, t: Turn): void {
  db.prepare(
    `
    INSERT INTO turns (
      id, session_id, turn_index, input_tokens, output_tokens, cumulative_tokens,
      ctx_pct, latency_ms, stop_reason, created_at,
      self_correction_count, repetition_score, output_density
    )
    VALUES (
      $id, $sessionId, $turnIndex, $inputTokens, $outputTokens, $cumulativeTokens,
      $ctxPct, $latencyMs, $stopReason, $createdAt,
      $selfCorrectionCount, $repetitionScore, $outputDensity
    )
  `,
  ).run({
    $id: t.id,
    $sessionId: t.sessionId,
    $turnIndex: t.turnIndex,
    $inputTokens: t.inputTokens,
    $outputTokens: t.outputTokens,
    $cumulativeTokens: t.cumulativeTokens,
    $ctxPct: t.ctxPct,
    $latencyMs: t.latencyMs,
    $stopReason: t.stopReason,
    $createdAt: t.createdAt,
    $selfCorrectionCount: t.selfCorrectionCount,
    $repetitionScore: t.repetitionScore,
    $outputDensity: t.outputDensity,
  });
}

export function insertGCEvent(db: Database, e: GCEvent): void {
  db.prepare(
    `
    INSERT INTO gc_events (id, session_id, gc_type, ctx_pct_at_trigger, created_at)
    VALUES ($id, $sessionId, $gcType, $ctxPctAtTrigger, $createdAt)
  `,
  ).run({
    $id: e.id,
    $sessionId: e.sessionId,
    $gcType: e.gcType,
    $ctxPctAtTrigger: e.ctxPctAtTrigger,
    $createdAt: e.createdAt,
  });
}

export function updateSessionLastActive(db: Database, sessionId: string): void {
  db.prepare(`UPDATE sessions SET last_active_at = $now WHERE id = $id`).run({
    $now: Date.now(),
    $id: sessionId,
  });
}

export function closeSession(db: Database, sessionId: string): void {
  db.prepare(
    `UPDATE sessions SET status = 'closed', last_active_at = $now WHERE id = $id`,
  ).run({ $now: Date.now(), $id: sessionId });
}

// Rows come back snake_cased from SQLite; map to the camelCase domain types.
function rowToSession(r: any): Session {
  return {
    id: r.id,
    name: r.name,
    model: r.model,
    ctxWindow: r.ctx_window,
    createdAt: r.created_at,
    lastActiveAt: r.last_active_at,
    status: r.status,
    outcomeStatus: r.outcome_status,
    forkedFrom: r.forked_from,
    projectId: r.project_id ?? null,
  };
}

function rowToTurn(r: any): Turn {
  return {
    id: r.id,
    sessionId: r.session_id,
    turnIndex: r.turn_index,
    inputTokens: r.input_tokens,
    outputTokens: r.output_tokens,
    cumulativeTokens: r.cumulative_tokens,
    ctxPct: r.ctx_pct,
    latencyMs: r.latency_ms,
    stopReason: r.stop_reason,
    createdAt: r.created_at,
    selfCorrectionCount: r.self_correction_count,
    repetitionScore: r.repetition_score,
    outputDensity: r.output_density,
  };
}

export function getSession(
  db: Database,
  sessionId: string,
): Session | undefined {
  const r = db
    .prepare(`SELECT * FROM sessions WHERE id = $id`)
    .get({ $id: sessionId });
  return r ? rowToSession(r) : undefined;
}

export function getSessionTurns(db: Database, sessionId: string): Turn[] {
  return db
    .prepare(
      `SELECT * FROM turns WHERE session_id = $sessionId ORDER BY turn_index ASC`,
    )
    .all({ $sessionId: sessionId })
    .map(rowToTurn);
}

export function getAllSessions(db: Database): Session[] {
  return db
    .prepare(`SELECT * FROM sessions ORDER BY created_at DESC`)
    .all()
    .map(rowToSession);
}

// ── Phase 4: projects + compaction ───────────────────────────────────────────

export function resolveProjectId(db: Database, cwd: string): string {
  const existing = db
    .prepare(`SELECT id FROM projects WHERE cwd = $cwd`)
    .get({ $cwd: cwd }) as { id: string } | undefined;
  if (existing) return existing.id;
  const id = uuidv4();
  db.prepare(
    `INSERT INTO projects (id, cwd, name, created_at)
     VALUES ($id, $cwd, $name, $createdAt)`,
  ).run({
    $id: id,
    $cwd: cwd,
    $name: basename(cwd) || cwd,
    $createdAt: Date.now(),
  });
  return id;
}

export function getProject(
  db: Database,
  projectId: string,
): Project | undefined {
  const r = db
    .prepare(`SELECT * FROM projects WHERE id = $id`)
    .get({ $id: projectId }) as any;
  return r
    ? { id: r.id, cwd: r.cwd, name: r.name, createdAt: r.created_at }
    : undefined;
}

export function getProjectByCwd(
  db: Database,
  cwd: string,
): Project | undefined {
  const r = db
    .prepare(`SELECT * FROM projects WHERE cwd = $cwd`)
    .get({ $cwd: cwd }) as any;
  return r
    ? { id: r.id, cwd: r.cwd, name: r.name, createdAt: r.created_at }
    : undefined;
}

export function getPolicy(
  db: Database,
  projectId: string,
): CompactionPolicy | undefined {
  const r = db
    .prepare(`SELECT * FROM compaction_policies WHERE project_id = $projectId`)
    .get({ $projectId: projectId }) as any;
  if (!r) return undefined;
  const config = JSON.parse(r.config) as Omit<
    CompactionPolicy,
    "id" | "project_id" | "created_at" | "updated_at"
  >;
  return {
    id: r.id,
    project_id: r.project_id,
    created_at: r.created_at,
    updated_at: r.updated_at,
    ...config,
  };
}

export function upsertPolicy(db: Database, policy: CompactionPolicy): void {
  const {
    id,
    project_id,
    name,
    active,
    triggers,
    memory_schema,
    cooldown_turns,
    created_at,
    updated_at,
  } = policy;
  const config = JSON.stringify({
    name,
    active,
    triggers,
    memory_schema,
    cooldown_turns,
  });
  db.prepare(
    `INSERT INTO compaction_policies (id, project_id, name, active, config, created_at, updated_at)
     VALUES ($id, $projectId, $name, $active, $config, $createdAt, $updatedAt)
     ON CONFLICT(project_id) DO UPDATE SET
       name = excluded.name, active = excluded.active,
       config = excluded.config, updated_at = excluded.updated_at`,
  ).run({
    $id: id,
    $projectId: project_id,
    $name: name,
    $active: active ? 1 : 0,
    $config: config,
    $createdAt: created_at,
    $updatedAt: updated_at,
  });
}

export function insertCompactionEvent(db: Database, e: CompactionEvent): void {
  db.prepare(
    `INSERT INTO compaction_events
     (id, session_id, policy_id, triggered_by, trigger_detail, files_written,
      tokens_at_trigger, status, started_at, completed_at, error)
     VALUES ($id, $sessionId, $policyId, $triggeredBy, $triggerDetail, $filesWritten,
             $tokensAtTrigger, $status, $startedAt, $completedAt, $error)`,
  ).run({
    $id: e.id,
    $sessionId: e.session_id,
    $policyId: e.policy_id,
    $triggeredBy: e.triggered_by,
    $triggerDetail: e.trigger_detail,
    $filesWritten: JSON.stringify(e.files_written),
    $tokensAtTrigger: e.tokens_at_trigger,
    $status: e.status,
    $startedAt: e.started_at,
    $completedAt: e.completed_at ?? null,
    $error: e.error ?? null,
  });
}

export function updateCompactionEvent(
  db: Database,
  id: string,
  patch: {
    status: "completed" | "failed";
    files_written?: CompactionFileResult[];
    completed_at: string;
    error?: string;
  },
): void {
  db.prepare(
    `UPDATE compaction_events
     SET status = $status, files_written = $filesWritten,
         completed_at = $completedAt, error = $error
     WHERE id = $id`,
  ).run({
    $id: id,
    $status: patch.status,
    $filesWritten: JSON.stringify(patch.files_written ?? []),
    $completedAt: patch.completed_at,
    $error: patch.error ?? null,
  });
}

export function getCompactionEvents(
  db: Database,
  sessionId: string,
): CompactionEvent[] {
  return (
    db
      .prepare(
        `SELECT * FROM compaction_events WHERE session_id = $sessionId ORDER BY started_at DESC`,
      )
      .all({ $sessionId: sessionId }) as any[]
  ).map((r) => ({
    id: r.id,
    session_id: r.session_id,
    policy_id: r.policy_id,
    triggered_by: r.triggered_by as TriggerTypeEnum,
    trigger_detail: r.trigger_detail,
    files_written: JSON.parse(r.files_written) as CompactionFileResult[],
    tokens_at_trigger: r.tokens_at_trigger,
    status: r.status,
    started_at: r.started_at,
    completed_at: r.completed_at ?? null,
    error: r.error ?? null,
  }));
}

export function getLastCompactionEvent(
  db: Database,
  sessionId: string,
): CompactionEvent | undefined {
  const r = db
    .prepare(
      `SELECT * FROM compaction_events
       WHERE session_id = $sessionId AND status = 'completed'
       ORDER BY completed_at DESC LIMIT 1`,
    )
    .get({ $sessionId: sessionId }) as any;
  if (!r) return undefined;
  return {
    id: r.id,
    session_id: r.session_id,
    policy_id: r.policy_id,
    triggered_by: r.triggered_by as TriggerTypeEnum,
    trigger_detail: r.trigger_detail,
    files_written: JSON.parse(r.files_written) as CompactionFileResult[],
    tokens_at_trigger: r.tokens_at_trigger,
    status: r.status,
    started_at: r.started_at,
    completed_at: r.completed_at ?? null,
    error: r.error ?? null,
  };
}
