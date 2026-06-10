import Database from "better-sqlite3";
import { join } from "path";
import type { Session, Turn, GCEvent, Outcome } from "./types.js";

const DB_PATH = process.env.CLAUDE_OS_DB_PATH ?? join(process.cwd(), "claude-os.sqlite");

let _db: Database.Database | null = null;

export function getDb(): Database.Database {
  if (_db) return _db;
  _db = new Database(DB_PATH);
  _db.pragma("journal_mode = WAL");
  _db.pragma("foreign_keys = ON");
  migrate(_db);
  return _db;
}

function migrate(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS sessions (
      id            TEXT PRIMARY KEY,
      name          TEXT,
      model         TEXT NOT NULL,
      ctx_window    INTEGER NOT NULL,
      created_at    INTEGER NOT NULL,
      last_active_at INTEGER NOT NULL,
      status        TEXT NOT NULL DEFAULT 'active',
      outcome_status TEXT NOT NULL DEFAULT 'unresolved',
      forked_from   TEXT REFERENCES sessions(id)
    );

    CREATE TABLE IF NOT EXISTS turns (
      id                 TEXT PRIMARY KEY,
      session_id         TEXT NOT NULL REFERENCES sessions(id),
      turn_index         INTEGER NOT NULL,
      input_tokens       INTEGER NOT NULL,
      output_tokens      INTEGER NOT NULL,
      cumulative_tokens  INTEGER NOT NULL,
      ctx_pct            REAL NOT NULL,
      latency_ms         INTEGER NOT NULL,
      stop_reason        TEXT,
      created_at         INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS gc_events (
      id                  TEXT PRIMARY KEY,
      session_id          TEXT NOT NULL REFERENCES sessions(id),
      gc_type             TEXT NOT NULL,
      ctx_pct_at_trigger  REAL NOT NULL,
      created_at          INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS outcomes (
      id          TEXT PRIMARY KEY,
      session_id  TEXT NOT NULL REFERENCES sessions(id),
      label       TEXT NOT NULL,
      resolved    INTEGER NOT NULL DEFAULT 0,
      resolved_at INTEGER
    );

    CREATE INDEX IF NOT EXISTS idx_turns_session ON turns(session_id);
    CREATE INDEX IF NOT EXISTS idx_gc_events_session ON gc_events(session_id);
    CREATE INDEX IF NOT EXISTS idx_outcomes_session ON outcomes(session_id);
  `);
}

export function insertSession(db: Database.Database, session: Session): void {
  db.prepare(`
    INSERT INTO sessions (id, name, model, ctx_window, created_at, last_active_at, status, outcome_status, forked_from)
    VALUES (@id, @name, @model, @ctxWindow, @createdAt, @lastActiveAt, @status, @outcomeStatus, @forkedFrom)
  `).run(session);
}

export function insertTurn(db: Database.Database, turn: Turn): void {
  db.prepare(`
    INSERT INTO turns (id, session_id, turn_index, input_tokens, output_tokens, cumulative_tokens, ctx_pct, latency_ms, stop_reason, created_at)
    VALUES (@id, @sessionId, @turnIndex, @inputTokens, @outputTokens, @cumulativeTokens, @ctxPct, @latencyMs, @stopReason, @createdAt)
  `).run(turn);
}

export function insertGCEvent(db: Database.Database, event: GCEvent): void {
  db.prepare(`
    INSERT INTO gc_events (id, session_id, gc_type, ctx_pct_at_trigger, created_at)
    VALUES (@id, @sessionId, @gcType, @ctxPctAtTrigger, @createdAt)
  `).run(event);
}

export function updateSessionLastActive(db: Database.Database, sessionId: string): void {
  db.prepare(`UPDATE sessions SET last_active_at = ? WHERE id = ?`).run(Date.now(), sessionId);
}

export function getSession(db: Database.Database, sessionId: string): Session | undefined {
  return db.prepare(`SELECT * FROM sessions WHERE id = ?`).get(sessionId) as Session | undefined;
}

export function getSessionTurns(db: Database.Database, sessionId: string): Turn[] {
  return db.prepare(`SELECT * FROM turns WHERE session_id = ? ORDER BY turn_index ASC`).all(sessionId) as Turn[];
}
