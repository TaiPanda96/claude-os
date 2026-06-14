#!/usr/bin/env bun
/**
 * Claude Code Stop hook — ingests the current session's latest turn.
 * Configured in ~/.claude/settings.json under hooks.Stop.
 *
 * Claude Code passes session info via stdin as JSON:
 *   { "session_id": "...", "transcript_path": "..." }
 */

import { Database } from "bun:sqlite";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ingestJsonLFile } from "@claude-os/core/ingest/ingest-jsonl-file.js";
import { initializeSchemas } from "@claude-os/core/ingest/initialize-schemas.js";
import { findJsonlForSession } from "@claude-os/core/ingest/find-jsonl-for-session.js";

const DB_PATH =
  process.env.CLAUDE_OS_DB_PATH ?? join(import.meta.dir, "../claude-os.sqlite");

// ── Parse stdin ───────────────────────────────────────────────────────────────
let hookInput: { session_id?: string; transcript_path?: string } = {};
try {
  const raw = readFileSync("/dev/stdin", "utf-8").trim();
  if (raw) hookInput = JSON.parse(raw);
} catch {
  /* no stdin */
}

const { session_id: sessionId, transcript_path: transcriptPath } = hookInput;
if (!sessionId && !transcriptPath) process.exit(0);

// ── Resolve JSONL path ────────────────────────────────────────────────────────
const filePath = findJsonlForSession(sessionId ?? "", transcriptPath);
if (!filePath) process.exit(0);

// ── Ingest ────────────────────────────────────────────────────────────────────
const db = new Database(DB_PATH);
db.run("PRAGMA journal_mode = WAL");
db.run("PRAGMA foreign_keys = ON");

initializeSchemas(db);
ingestJsonLFile(db, filePath, { verbose: false });

db.close();
process.exit(0);
