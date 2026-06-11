#!/usr/bin/env bun
/**
 * Claude Code Stop hook — ingests the current session's latest turn.
 * Configured in ~/.claude/settings.json under hooks.Stop.
 *
 * Claude Code passes session info via stdin as JSON:
 *   { "session_id": "...", "transcript_path": "..." }
 *
 * Falls back to scanning all JSONL files for the session_id if transcript_path
 * is not provided.
 */

import { Database } from "bun:sqlite";
import { existsSync, readFileSync } from "fs";
import { join } from "path";
import { homedir } from "os";
import {
  computeGCState,
  MODEL_CONTEXT_WINDOWS,
  SELF_CORRECTION_MARKERS,
} from "../packages/core/src/types.js";

const DB_PATH =
  process.env.CLAUDE_OS_DB_PATH ?? join(import.meta.dir, "../claude-os.sqlite");
const PROJECTS = join(homedir(), ".claude", "projects");

// Read hook input from stdin
let hookInput: { session_id?: string; transcript_path?: string } = {};
try {
  const raw = readFileSync("/dev/stdin", "utf-8").trim();
  if (raw) hookInput = JSON.parse(raw);
} catch {
  /* no stdin, proceed */
}

const sessionId = hookInput.session_id;
const transcriptPath = hookInput.transcript_path;

if (!sessionId && !transcriptPath) {
  // Nothing to ingest — exit silently
  process.exit(0);
}

// Find the JSONL file to ingest
let filePath = transcriptPath ?? "";
if (!filePath || !existsSync(filePath)) {
  // Scan projects dir for the sessionId
  const { readdirSync } = await import("fs");
  outer: for (const dir of readdirSync(PROJECTS)) {
    const dirPath = join(PROJECTS, dir);
    try {
      for (const file of readdirSync(dirPath).filter((f: string) =>
        f.endsWith(".jsonl"),
      )) {
        if (file.includes(sessionId ?? "")) {
          filePath = join(dirPath, file);
          break outer;
        }
      }
    } catch {
      continue;
    }
  }
}

if (!filePath || !existsSync(filePath)) process.exit(0);

const db = new Database(DB_PATH);
db.run("PRAGMA journal_mode = WAL");
db.run("PRAGMA foreign_keys = ON");

const lines = readFileSync(filePath, "utf-8").split("\n").filter(Boolean);
const records = lines.flatMap((l) => {
  try {
    return [JSON.parse(l)];
  } catch {
    return [];
  }
});

const userByUuid = new Map<string, { uuid: string; timestamp: string }>();
for (const r of records) {
  if (r.type === "user") userByUuid.set(r.uuid, r);
}

const assistants = records
  .filter((r) => r.type === "assistant" && r.message?.usage)
  .sort(
    (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime(),
  );

if (assistants.length === 0) process.exit(0);

const model = assistants[0].message.model ?? "claude-sonnet-4-6";
const ctxWindow = MODEL_CONTEXT_WINDOWS[model] ?? 200_000;
const createdAt = new Date(assistants[0].timestamp).getTime();
const lastAt = new Date(assistants[assistants.length - 1].timestamp).getTime();

db.prepare(
  `
  INSERT INTO sessions (id, name, model, ctx_window, created_at, last_active_at, status, outcome_status, forked_from)
  VALUES ($id, $name, $model, $ctx, $created, $last, 'active', 'unresolved', null)
  ON CONFLICT(id) DO UPDATE SET last_active_at = excluded.last_active_at
`,
).run({
  $id: assistants[0].sessionId,
  $name: null,
  $model: model,
  $ctx: ctxWindow,
  $created: createdAt,
  $last: lastAt,
});

let lastOutputText = "";
let lastGCState = "clean";

for (let i = 0; i < assistants.length; i++) {
  const turn = assistants[i];
  const u = turn.message.usage;
  const cacheRead = u.cache_read_input_tokens ?? 0;
  const cacheCreation = u.cache_creation_input_tokens ?? 0;
  const effectiveInput = u.input_tokens + cacheRead + cacheCreation;
  const ctxPct = effectiveInput / ctxWindow;

  const parent = userByUuid.get(turn.parentUuid);
  const latencyMs = parent
    ? new Date(turn.timestamp).getTime() - new Date(parent.timestamp).getTime()
    : 0;

  const outputText = (turn.message.content ?? [])
    .filter((b: { type: string }) => b.type === "text")
    .map((b: { text?: string }) => b.text ?? "")
    .join("\n");

  const result = db
    .prepare(
      `
    INSERT OR IGNORE INTO turns (
      id, session_id, turn_index, input_tokens, output_tokens, cumulative_tokens,
      ctx_pct, latency_ms, stop_reason, created_at,
      self_correction_count, repetition_score, output_density,
      cache_read_tokens, cache_creation_tokens, effective_input_tokens, cwd
    ) VALUES (
      $id, $sid, $idx, $in, $out, $cum, $ctx, $lat, $stop, $ts,
      $sc, $rep, $dens, $cr, $cc, $eff, $cwd
    )
  `,
    )
    .run({
      $id: turn.uuid,
      $sid: turn.sessionId,
      $idx: i,
      $in: u.input_tokens,
      $out: u.output_tokens,
      $cum: effectiveInput + u.output_tokens,
      $ctx: ctxPct,
      $lat: latencyMs,
      $stop: turn.message.stop_reason,
      $ts: new Date(turn.timestamp).getTime(),
      $sc: countSelfCorrections(outputText),
      $rep: bigramOverlap(lastOutputText, outputText),
      $dens: effectiveInput > 0 ? u.output_tokens / effectiveInput : 0,
      $cr: cacheRead,
      $cc: cacheCreation,
      $eff: effectiveInput,
      $cwd: turn.cwd ?? "",
    });

  if ((result as { changes: number }).changes > 0) {
    const gcState = computeGCState(ctxPct);
    if (gcState !== lastGCState && gcState !== "clean") {
      db.prepare(
        `INSERT OR IGNORE INTO gc_events (id, session_id, gc_type, ctx_pct_at_trigger, created_at) VALUES ($id, $sid, $gc, $ctx, $ts)`,
      ).run({
        $id: `${turn.uuid}-gc`,
        $sid: turn.sessionId,
        $gc: gcState,
        $ctx: ctxPct,
        $ts: new Date(turn.timestamp).getTime(),
      });
    }
    lastGCState = gcState;
  }
  lastOutputText = outputText;
}

db.close();
// Exit 0 — Claude Code will proceed normally
process.exit(0);
