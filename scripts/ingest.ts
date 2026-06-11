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

import { parseArgs } from "util";
import { Database } from "bun:sqlite";
import { readdirSync, readFileSync, existsSync } from "fs";
import { join, basename } from "path";
import { homedir } from "os";
import {
  computeGCState,
  MODEL_CONTEXT_WINDOWS,
  SELF_CORRECTION_MARKERS,
} from "../packages/core/src/types.js";

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

const DB_PATH = values.db ?? join(import.meta.dir, "../claude-os.sqlite");
const PROJECTS = join(homedir(), ".claude", "projects");

// ── DB setup ─────────────────────────────────────────────────────────────────
const db = new Database(DB_PATH);
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

// ── Quality signals ───────────────────────────────────────────────────────────
function countSelfCorrections(text: string): number {
  const lower = text.toLowerCase();
  return SELF_CORRECTION_MARKERS.reduce((n, marker) => {
    let count = 0,
      pos = 0;
    while ((pos = lower.indexOf(marker, pos)) !== -1) {
      count++;
      pos += marker.length;
    }
    return n + count;
  }, 0);
}

function bigrams(text: string): Set<string> {
  const words = text.toLowerCase().split(/\s+/).filter(Boolean);
  const bg = new Set<string>();
  for (let i = 0; i < words.length - 1; i++)
    bg.add(`${words[i]} ${words[i + 1]}`);
  return bg;
}

function bigramOverlap(a: string, b: string): number {
  if (!a || !b) return 0;
  const bgA = bigrams(a),
    bgB = bigrams(b);
  if (bgA.size === 0 || bgB.size === 0) return 0;
  let shared = 0;
  for (const bg of bgA) {
    if (bgB.has(bg)) shared++;
  }
  return shared / Math.max(bgA.size, bgB.size);
}

// ── JSONL record types ────────────────────────────────────────────────────────
interface AssistantRecord {
  type: "assistant";
  uuid: string;
  parentUuid?: string;
  sessionId: string;
  timestamp: string;
  cwd: string;
  message: {
    model: string;
    stop_reason: string | null;
    content: Array<{ type: string; text?: string }>;
    usage: {
      input_tokens: number;
      output_tokens: number;
      cache_read_input_tokens?: number;
      cache_creation_input_tokens?: number;
    };
  };
}

interface UserRecord {
  type: "user";
  uuid: string;
  sessionId: string;
  timestamp: string;
  message: { content: string | Array<{ type: string; text?: string }> };
}

// ── Ingest one JSONL file ────────────────────────────────────────────────────
function ingestFile(filePath: string): {
  sessions: number;
  turns: number;
  skipped: number;
} {
  const lines = readFileSync(filePath, "utf-8").split("\n").filter(Boolean);
  const records = lines.flatMap((l) => {
    try {
      return [JSON.parse(l)];
    } catch {
      return [];
    }
  });

  // Index user records by uuid for latency calculation
  const userByUuid = new Map<string, UserRecord>();
  for (const r of records) {
    if (r.type === "user") userByUuid.set(r.uuid, r as UserRecord);
  }

  // Group assistant records by sessionId
  const bySession = new Map<string, AssistantRecord[]>();
  for (const r of records) {
    if (r.type !== "assistant") continue;
    const a = r as AssistantRecord;
    if (!a.message?.usage) continue;
    const arr = bySession.get(a.sessionId) ?? [];
    arr.push(a);
    bySession.set(a.sessionId, arr);
  }

  let sessionsInserted = 0,
    turnsInserted = 0,
    turnsSkipped = 0;

  for (const [sessionId, turns] of bySession) {
    // Sort by timestamp
    turns.sort(
      (a, b) =>
        new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime(),
    );

    const model = turns[0]?.message.model ?? "claude-sonnet-4-6";
    const ctxWindow = MODEL_CONTEXT_WINDOWS[model] ?? 200_000;
    const createdAt = new Date(turns[0]?.timestamp ?? Date.now()).getTime();
    const lastActiveAt = new Date(
      turns[turns.length - 1]?.timestamp ?? Date.now(),
    ).getTime();
    const cwd = turns[0]?.cwd ?? "";
    const name = basename(cwd) || null;

    // Upsert session
    db.prepare(
      `
      INSERT INTO sessions (id, name, model, ctx_window, created_at, last_active_at, status, outcome_status, forked_from)
      VALUES ($id, $name, $model, $ctxWindow, $createdAt, $lastActiveAt, 'active', 'unresolved', null)
      ON CONFLICT(id) DO UPDATE SET last_active_at = excluded.last_active_at, model = excluded.model
    `,
    ).run({
      $id: sessionId,
      $name: name,
      $model: model,
      $ctxWindow: ctxWindow,
      $createdAt: createdAt,
      $lastActiveAt: lastActiveAt,
    });
    sessionsInserted++;

    let lastOutputText = "";
    let lastGCState = "clean";

    for (let i = 0; i < turns.length; i++) {
      const turn = turns[i]!;
      const u = turn.message.usage;
      const cacheRead = u.cache_read_input_tokens ?? 0;
      const cacheCreation = u.cache_creation_input_tokens ?? 0;
      const effectiveInput = u.input_tokens + cacheRead + cacheCreation;
      // cumulative = effective input for this turn (already contains full history) + output
      const cumulativeTokens = effectiveInput + u.output_tokens;
      const ctxPct = effectiveInput / ctxWindow;

      // Latency: find the preceding user record via parentUuid or timestamp proximity
      const userRecord = turn.parentUuid
        ? userByUuid.get(turn.parentUuid)
        : undefined;
      const latencyMs = userRecord
        ? new Date(turn.timestamp).getTime() -
          new Date(userRecord.timestamp).getTime()
        : 0;

      // Output text
      const outputText = turn.message.content
        .filter((b) => b.type === "text")
        .map((b) => b.text ?? "")
        .join("\n");

      const selfCorrectionCount = countSelfCorrections(outputText);
      const repetitionScore = bigramOverlap(lastOutputText, outputText);
      const outputDensity =
        effectiveInput > 0 ? u.output_tokens / effectiveInput : 0;

      // INSERT OR IGNORE — idempotent
      const result = db
        .prepare(
          `
        INSERT OR IGNORE INTO turns (
          id, session_id, turn_index, input_tokens, output_tokens, cumulative_tokens,
          ctx_pct, latency_ms, stop_reason, created_at,
          self_correction_count, repetition_score, output_density,
          cache_read_tokens, cache_creation_tokens, effective_input_tokens, cwd
        ) VALUES (
          $id, $sessionId, $turnIndex, $inputTokens, $outputTokens, $cumulativeTokens,
          $ctxPct, $latencyMs, $stopReason, $createdAt,
          $selfCorrectionCount, $repetitionScore, $outputDensity,
          $cacheRead, $cacheCreation, $effectiveInput, $cwd
        )
      `,
        )
        .run({
          $id: turn.uuid,
          $sessionId: sessionId,
          $turnIndex: i,
          $inputTokens: u.input_tokens,
          $outputTokens: u.output_tokens,
          $cumulativeTokens: cumulativeTokens,
          $ctxPct: ctxPct,
          $latencyMs: latencyMs,
          $stopReason: turn.message.stop_reason,
          $createdAt: new Date(turn.timestamp).getTime(),
          $selfCorrectionCount: selfCorrectionCount,
          $repetitionScore: repetitionScore,
          $outputDensity: outputDensity,
          $cacheRead: cacheRead,
          $cacheCreation: cacheCreation,
          $effectiveInput: effectiveInput,
          $cwd: cwd,
        });

      if ((result as { changes: number }).changes === 0) {
        turnsSkipped++;
      } else {
        turnsInserted++;

        // GC events
        const gcState = computeGCState(ctxPct);
        if (gcState !== lastGCState && gcState !== "clean") {
          const gcId = `${turn.uuid}-gc`;
          db.prepare(
            `
            INSERT OR IGNORE INTO gc_events (id, session_id, gc_type, ctx_pct_at_trigger, created_at)
            VALUES ($id, $sessionId, $gcType, $ctxPct, $createdAt)
          `,
          ).run({
            $id: gcId,
            $sessionId: sessionId,
            $gcType: gcState,
            $ctxPct: ctxPct,
            $createdAt: new Date(turn.timestamp).getTime(),
          });
        }
        lastGCState = gcState;
      }

      lastOutputText = outputText;
    }

    if (values.verbose) {
      const lastTurn = turns[turns.length - 1]!;
      const u = lastTurn.message.usage;
      const effectiveInput =
        u.input_tokens +
        (u.cache_read_input_tokens ?? 0) +
        (u.cache_creation_input_tokens ?? 0);
      const ctxPct = effectiveInput / ctxWindow;
      console.log(
        `  ${sessionId.slice(0, 8)}  ${turns.length} turns  ctx=${(ctxPct * 100).toFixed(1)}%  ${name}`,
      );
    }
  }

  return {
    sessions: sessionsInserted,
    turns: turnsInserted,
    skipped: turnsSkipped,
  };
}

// ── Stats ─────────────────────────────────────────────────────────────────────
function printStats() {
  const sessions = db.prepare(`SELECT COUNT(*) as n FROM sessions`).get() as {
    n: number;
  };
  const turns = db.prepare(`SELECT COUNT(*) as n FROM turns`).get() as {
    n: number;
  };
  const gcEvents = db.prepare(`SELECT COUNT(*) as n FROM gc_events`).get() as {
    n: number;
  };

  console.log(`\n\x1b[1mClaude OS — DB Summary\x1b[0m`);
  console.log(`  Sessions:  ${sessions.n}`);
  console.log(`  Turns:     ${turns.n}`);
  console.log(`  GC events: ${gcEvents.n}`);
  console.log(`  DB path:   ${DB_PATH}\n`);

  const rows = db
    .prepare(
      `
    SELECT s.id, s.name, s.model,
      COUNT(t.id) as turn_count,
      MAX(t.ctx_pct) as max_ctx_pct,
      MAX(t.effective_input_tokens) as max_effective_input
    FROM sessions s
    LEFT JOIN turns t ON t.session_id = s.id
    GROUP BY s.id
    ORDER BY s.last_active_at DESC
    LIMIT 20
  `,
    )
    .all() as Array<{
    id: string;
    name: string | null;
    model: string;
    turn_count: number;
    max_ctx_pct: number;
    max_effective_input: number;
  }>;

  if (rows.length === 0) {
    console.log("  No data yet. Run ingest first.\n");
    return;
  }

  console.log(
    `${"session".padEnd(10)} ${"turns".padStart(5)} ${"max ctx%".padStart(9)} ${"model".padEnd(28)} name`,
  );
  console.log("─".repeat(80));
  for (const r of rows) {
    const gc =
      r.max_ctx_pct >= 0.8
        ? "\x1b[31m"
        : r.max_ctx_pct >= 0.6
          ? "\x1b[33m"
          : "\x1b[32m";
    console.log(
      `${r.id.slice(0, 8).padEnd(10)} ` +
        `${String(r.turn_count).padStart(5)} ` +
        `${gc}${(r.max_ctx_pct * 100).toFixed(1).padStart(8)}%\x1b[0m ` +
        `${r.model.padEnd(28)} ` +
        `${r.name ?? "—"}`,
    );
  }
  console.log();
}

// ── Main ──────────────────────────────────────────────────────────────────────
if (values.stats) {
  printStats();
  process.exit(0);
}

let totalSessions = 0,
  totalTurns = 0,
  totalSkipped = 0;

if (values.file) {
  if (!existsSync(values.file)) {
    console.error(`File not found: ${values.file}`);
    process.exit(1);
  }
  console.log(`Ingesting ${values.file}...`);
  const r = ingestFile(values.file);
  totalSessions += r.sessions;
  totalTurns += r.turns;
  totalSkipped += r.skipped;
} else {
  // Walk ~/.claude/projects/
  const projectDirs = readdirSync(PROJECTS).filter((d) => {
    if (values.project) return d.includes(values.project);
    return true;
  });

  for (const projectDir of projectDirs) {
    const dir = join(PROJECTS, projectDir);
    let jsonlFiles: string[];
    try {
      jsonlFiles = readdirSync(dir).filter((f) => f.endsWith(".jsonl"));
    } catch {
      continue;
    }

    if (jsonlFiles.length === 0) continue;
    if (!values.verbose)
      process.stdout.write(`${projectDir.slice(0, 50).padEnd(52)}`);

    for (const file of jsonlFiles) {
      const r = ingestFile(join(dir, file));
      totalSessions += r.sessions;
      totalTurns += r.turns;
      totalSkipped += r.skipped;
    }
    if (!values.verbose) console.log(`${jsonlFiles.length} file(s)`);
  }
}

console.log(
  `\n\x1b[32m✓\x1b[0m Ingested ${totalTurns} new turns across ${totalSessions} sessions (${totalSkipped} already present)\n`,
);
printStats();
