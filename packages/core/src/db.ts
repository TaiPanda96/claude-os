import { join } from "node:path";
import { Database } from "bun:sqlite";
import { migrateDb } from "./db/migrate.js";

export type { Database };

let _db: Database | null = null;

export function getDb(dbPath?: string): Database {
  if (_db) return _db;
  const resolved =
    dbPath ?? process.env.CLAUDE_OS_DB_PATH ?? join(import.meta.dir, "../../../claude-os.sqlite");
  _db = new Database(resolved);
  _db.run("PRAGMA journal_mode = WAL");
  _db.run("PRAGMA foreign_keys = ON");
  migrateDb(_db);
  return _db;
}

export * from "./db/queries.js";
