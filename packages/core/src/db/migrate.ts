import { Database } from "bun:sqlite";

// Bump SCHEMA_VERSION and add a new version block whenever the schema changes.
export const SCHEMA_VERSION = 3;

export function migrateDb(db: Database): void {
  const version = (db.prepare("PRAGMA user_version").get() as { user_version: number })
    .user_version;
  if (version >= SCHEMA_VERSION) return;

  db.run("BEGIN");
  try {
    if (version < 1) {
      v1(db);
    }
    if (version < 2) {
      v2(db);
    }
    if (version < 3) {
      v3(db);
    }
    db.run(`PRAGMA user_version = ${SCHEMA_VERSION}`);
    db.run("COMMIT");
  } catch (err) {
    db.run("ROLLBACK");
    throw err;
  }
}

// ── v1: core tables ───────────────────────────────────────────────────────────

function v1(db: Database): void {
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
      id                     TEXT PRIMARY KEY,
      session_id             TEXT NOT NULL REFERENCES sessions(id),
      turn_index             INTEGER NOT NULL,
      input_tokens           INTEGER NOT NULL,
      output_tokens          INTEGER NOT NULL,
      cumulative_tokens      INTEGER NOT NULL,
      ctx_pct                REAL NOT NULL,
      latency_ms             INTEGER NOT NULL,
      stop_reason            TEXT,
      created_at             INTEGER NOT NULL,
      self_correction_count  INTEGER NOT NULL DEFAULT 0,
      repetition_score       REAL NOT NULL DEFAULT 0,
      output_density         REAL NOT NULL DEFAULT 0,
      cache_read_tokens      INTEGER NOT NULL DEFAULT 0,
      cache_creation_tokens  INTEGER NOT NULL DEFAULT 0,
      effective_input_tokens INTEGER NOT NULL DEFAULT 0,
      cwd                    TEXT
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
  db.run(`CREATE INDEX IF NOT EXISTS idx_turns_session ON turns(session_id)`);
  db.run(`CREATE UNIQUE INDEX IF NOT EXISTS idx_turns_unique_session_index ON turns(session_id, turn_index)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_gc_events_session ON gc_events(session_id)`);
}

// ── v2: Phase 4 — projects + compaction + project_id on sessions ──────────────

function v2(db: Database): void {
  db.run(`
    CREATE TABLE IF NOT EXISTS projects (
      id         TEXT PRIMARY KEY,
      cwd        TEXT NOT NULL UNIQUE,
      name       TEXT NOT NULL,
      created_at INTEGER NOT NULL
    )
  `);
  try {
    db.run(`ALTER TABLE sessions ADD COLUMN project_id TEXT REFERENCES projects(id)`);
  } catch {
    /* column already exists — DB was initialised before migrateDb was wired in */
  }
  db.run(`CREATE INDEX IF NOT EXISTS idx_sessions_project ON sessions(project_id)`);
  db.run(`
    CREATE TABLE IF NOT EXISTS compaction_policies (
      id          TEXT PRIMARY KEY,
      project_id  TEXT NOT NULL UNIQUE,
      name        TEXT NOT NULL,
      active      INTEGER NOT NULL DEFAULT 1,
      config      TEXT NOT NULL,
      created_at  TEXT NOT NULL,
      updated_at  TEXT NOT NULL,
      FOREIGN KEY (project_id) REFERENCES projects(id)
    )
  `);
  db.run(`
    CREATE TABLE IF NOT EXISTS compaction_events (
      id                TEXT PRIMARY KEY,
      session_id        TEXT NOT NULL,
      policy_id         TEXT NOT NULL,
      triggered_by      TEXT NOT NULL,
      trigger_detail    TEXT NOT NULL,
      files_written     TEXT NOT NULL,
      tokens_at_trigger INTEGER NOT NULL,
      status            TEXT NOT NULL CHECK(status IN ('running','completed','failed')),
      started_at        TEXT NOT NULL,
      completed_at      TEXT,
      error             TEXT,
      FOREIGN KEY (session_id) REFERENCES sessions(id),
      FOREIGN KEY (policy_id)  REFERENCES compaction_policies(id)
    )
  `);
  db.run(`
    CREATE INDEX IF NOT EXISTS idx_compaction_events_session
    ON compaction_events(session_id, started_at DESC)
  `);

  // Backfill project rows from existing turns.cwd, then link sessions to them.
  db.run(`
    INSERT OR IGNORE INTO projects (id, cwd, name, created_at)
    SELECT
      lower(hex(randomblob(4)) || '-' || hex(randomblob(2)) || '-4' ||
            substr(hex(randomblob(2)),2) || '-' ||
            substr('89ab', abs(random()) % 4 + 1, 1) ||
            substr(hex(randomblob(2)),2) || '-' || hex(randomblob(6))),
      cwd,
      substr(cwd, instr(cwd, rtrim(cwd, replace(cwd, '/', ''))) + 1),
      strftime('%s','now') * 1000
    FROM (SELECT DISTINCT cwd FROM turns WHERE cwd IS NOT NULL AND cwd != '')
  `);
  db.run(`
    UPDATE sessions
    SET project_id = (
      SELECT p.id FROM projects p
      WHERE p.cwd = (
        SELECT t.cwd FROM turns t
        WHERE t.session_id = sessions.id AND t.cwd IS NOT NULL AND t.cwd != ''
        LIMIT 1
      )
    )
    WHERE project_id IS NULL
  `);
}

// ── v3: cost telemetry — pricing_version on turns ─────────────────────────────

function v3(db: Database): void {
  // SQLite does not support ALTER TABLE … ADD COLUMN IF NOT EXISTS; use try/catch.
  try {
    db.run(`ALTER TABLE turns ADD COLUMN pricing_version TEXT NOT NULL DEFAULT ''`);
  } catch {
    /* column already exists */
  }
}
