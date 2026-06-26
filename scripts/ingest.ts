#!/usr/bin/env bun
/**
 * Ingests Claude Code session JSONL files into the claude-os SQLite store.
 * Idempotent — safe to re-run; existing turns are skipped via INSERT OR IGNORE.
 *
 * Usage:
 *   bun run scripts/ingest.ts                          # all projects
 *   bun run scripts/ingest.ts --project finance        # one project (substring match on cwd)
 *   bun run scripts/ingest.ts --file /path/to/x.jsonl  # one file
 *   bun run scripts/ingest.ts --stats                  # print DB summary only
 */
import { program } from "@commander-js/extra-typings";
import { parseArgs } from "util";
import { Database } from "bun:sqlite";
import { join } from "path";
import { homedir } from "os";
import { initializeSchemas } from "@claude-os/core/ingest/initialize-schemas.js";
import { printIngestStats } from "@claude-os/core/ingest/print-ingest-stats.js";
import { migrateDb } from "@claude-os/core/db/migrate.js";
import { walkClaudeDirectoryIo } from "./walk-claude-directory-io.js";

const PROJECTS = join(homedir(), ".claude", "projects");

program
  .name("ingest")
  .description(
    "Ingest claude project sessions - iterating over per-session JSONL to capture instrumentation",
  )
  .option("--limit <n>", "Cap on clinics considered this run")
  .option("--no-dry-run", "Actually enqueue child scrape jobs (default: dry-run)")
  .option("--out <path>", "Write the JSON summary to this path")
  .option("--stats", "Print DB summary only")
  .action(async (opts: { stats?: boolean }) => {
    // ── Args ────────────────────────────────────────────────────────────────────
    const { values } = parseArgs({
      args: Bun.argv.slice(2),
      options: {
        project: { type: "string" },
        file: { type: "string" },
        stats: { type: "boolean", default: false },
        db: {
          type: "string",
          default: join(import.meta.dir, "../claude-os.sqlite"),
        },
        verbose: { type: "boolean", default: false },
      },
      strict: true,
    });

    const stats = opts.stats || values.stats;
    // Setup DB
    const DB_PATH = values.db ?? join(import.meta.dir, "../claude-os.sqlite");
    // ── DB setup ─────────────────────────────────────────────────────────────────
    const db = new Database(DB_PATH);
    db.run("PRAGMA journal_mode = WAL");
    db.run("PRAGMA foreign_keys = ON");
    migrateDb(db);
    initializeSchemas(db);

    // ── Main ──────────────────────────────────────────────────────────────────────
    if (stats) {
      printIngestStats(db, { databasePath: DB_PATH });
      process.exit(0);
    }
    walkClaudeDirectoryIo(db, { values, projectDirRoot: PROJECTS });
    printIngestStats(db, { databasePath: DB_PATH });
  });

program.parse();
