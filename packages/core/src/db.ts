import { join } from "node:path";
import { Database } from "bun:sqlite";
import { migrateDb } from "./db/migrate.js";

export type { Database };

let _db: Database | null = null;

/**
 * Singleton accessor for the database connection.
 * If a connection has already been established, it will return that connection.
 * Otherwise, it will create a new connection to the database at the specified path or the default path.
 *
 * @param dbPath - Optional path to the database file. If not provided, it will use the environment variable `CLAUDE_OS_DB_PATH` or default to `claude-os.sqlite` in the project root.
 * @returns The singleton database connection.
 */
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
