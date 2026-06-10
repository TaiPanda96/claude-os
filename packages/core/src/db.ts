import { Database } from "bun:sqlite";
import { join } from "path";
import type { Session, Turn, GCEvent } from "./types.js";

const DB_PATH = process.env.CLAUDE_OS_DB_PATH ?? join(process.cwd(), "claude-os.sqlite");

let _db: Database | null = null;

export function getDb(): Database {
  if (_db) return _db;
  _db = new Database(DB_PATH);
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
      id                TEXT PRIMARY KEY,
      session_id        TEXT NOT NULL REFERENCES sessions(id),
      turn_index        INTEGER NOT NULL,
      input_tokens      INTEGER NOT NULL,
      output_tokens     INTEGER NOT NULL,
      cumulative_tokens INTEGER NOT NULL,
      ctx_pct           REAL NOT NULL,
      latency_ms        INTEGER NOT NULL,
      stop_reason       TEXT,
      created_at        INTEGER NOT NULL
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
  db.run(`CREATE INDEX IF NOT EXISTS idx_gc_events_session ON gc_events(session_id)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_outcomes_session ON outcomes(session_id)`);
}

export function insertSession(db: Database, s: Session): void {
  db.prepare(`
    INSERT INTO sessions (id, name, model, ctx_window, created_at, last_active_at, status, outcome_status, forked_from)
    VALUES ($id, $name, $model, $ctxWindow, $createdAt, $lastActiveAt, $status, $outcomeStatus, $forkedFrom)
  `).run({
    $id: s.id, $name: s.name, $model: s.model, $ctxWindow: s.ctxWindow,
    $createdAt: s.createdAt, $lastActiveAt: s.lastActiveAt,
    $status: s.status, $outcomeStatus: s.outcomeStatus, $forkedFrom: s.forkedFrom,
  });
}

export function insertTurn(db: Database, t: Turn): void {
  db.prepare(`
    INSERT INTO turns (id, session_id, turn_index, input_tokens, output_tokens, cumulative_tokens, ctx_pct, latency_ms, stop_reason, created_at)
    VALUES ($id, $sessionId, $turnIndex, $inputTokens, $outputTokens, $cumulativeTokens, $ctxPct, $latencyMs, $stopReason, $createdAt)
  `).run({
    $id: t.id, $sessionId: t.sessionId, $turnIndex: t.turnIndex,
    $inputTokens: t.inputTokens, $outputTokens: t.outputTokens,
    $cumulativeTokens: t.cumulativeTokens, $ctxPct: t.ctxPct,
    $latencyMs: t.latencyMs, $stopReason: t.stopReason, $createdAt: t.createdAt,
  });
}

export function insertGCEvent(db: Database, e: GCEvent): void {
  db.prepare(`
    INSERT INTO gc_events (id, session_id, gc_type, ctx_pct_at_trigger, created_at)
    VALUES ($id, $sessionId, $gcType, $ctxPctAtTrigger, $createdAt)
  `).run({
    $id: e.id, $sessionId: e.sessionId, $gcType: e.gcType,
    $ctxPctAtTrigger: e.ctxPctAtTrigger, $createdAt: e.createdAt,
  });
}

export function updateSessionLastActive(db: Database, sessionId: string): void {
  db.prepare(`UPDATE sessions SET last_active_at = $now WHERE id = $id`).run({ $now: Date.now(), $id: sessionId });
}

export function getSession(db: Database, sessionId: string): Session | undefined {
  return db.prepare(`SELECT * FROM sessions WHERE id = $id`).get({ $id: sessionId }) as Session | undefined;
}

export function getSessionTurns(db: Database, sessionId: string): Turn[] {
  return db.prepare(`SELECT * FROM turns WHERE session_id = $sessionId ORDER BY turn_index ASC`).all({ $sessionId: sessionId }) as Turn[];
}
