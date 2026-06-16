import { type Database } from "../db.js";

// Schema is now fully owned by migrateDb() in db.ts (PRAGMA user_version gated).
// This function is kept for call-site compatibility but is a no-op — callers that
// already hold a db from getDb() have a fully-initialized schema by the time
// getDb() returns.
export function initializeSchemas(_db: Database): void {}
