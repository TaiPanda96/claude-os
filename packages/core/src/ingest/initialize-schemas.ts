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
  db.run(
    `CREATE INDEX IF NOT EXISTS idx_gc_events_session ON gc_events(session_id)`,
  );
}
