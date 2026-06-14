import { Database } from "../db.js";

export function initializeSchemas(db: Database) {
  db.run("PRAGMA journal_mode = WAL");
  db.run("PRAGMA foreign_keys = ON");
  db.run(`
      CREATE TABLE IF NOT EXISTS sessions (
        id TEXT PRIMARY KEY, name TEXT, model TEXT NOT NULL,
        ctx_window INTEGER NOT NULL, created_at INTEGER NOT NULL,
        last_active_at INTEGER NOT NULL, status TEXT NOT NULL DEFAULT 'active',
        outcome_status TEXT NOT NULL DEFAULT 'unresolved', forked_from TEXT
      )
    `);
  db.run(`
      CREATE TABLE IF NOT EXISTS turns (
        id TEXT PRIMARY KEY, session_id TEXT NOT NULL, turn_index INTEGER NOT NULL,
        input_tokens INTEGER NOT NULL, output_tokens INTEGER NOT NULL,
        cumulative_tokens INTEGER NOT NULL, ctx_pct REAL NOT NULL,
        latency_ms INTEGER NOT NULL, stop_reason TEXT, created_at INTEGER NOT NULL,
        self_correction_count INTEGER NOT NULL DEFAULT 0,
        repetition_score REAL NOT NULL DEFAULT 0,
        output_density REAL NOT NULL DEFAULT 0,
        -- Claude Code extras
        cache_read_tokens INTEGER NOT NULL DEFAULT 0,
        cache_creation_tokens INTEGER NOT NULL DEFAULT 0,
        effective_input_tokens INTEGER NOT NULL DEFAULT 0,
        cwd TEXT
      )
    `);
  db.run(`CREATE TABLE IF NOT EXISTS gc_events (
  id TEXT PRIMARY KEY, session_id TEXT NOT NULL, gc_type TEXT NOT NULL,
  ctx_pct_at_trigger REAL NOT NULL, created_at INTEGER NOT NULL
)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_turns_session ON turns(session_id)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_gc_events_session ON gc_events(session_id)`);

  // ── Phase 4: policy-driven compaction ────────────────────────────────────────

  db.run(`
    CREATE TABLE IF NOT EXISTS projects (
      id         TEXT PRIMARY KEY,
      cwd        TEXT NOT NULL UNIQUE,
      name       TEXT NOT NULL,
      created_at INTEGER NOT NULL
    )
  `);

  // Add project_id to sessions if not yet present (safe on existing DBs)
  try {
    db.run(`ALTER TABLE sessions ADD COLUMN project_id TEXT REFERENCES projects(id)`);
  } catch {
    // Column already exists — ignore
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

  // Backfill project_id for existing sessions. cwd lives on turns, not sessions,
  // so derive distinct project cwds from the turns table.
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
