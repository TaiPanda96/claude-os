#!/usr/bin/env bun
/**
 * Exports session turn data to JSON and CSV for notebook analysis.
 *
 * Usage:
 *   bun run src/export.ts                        # exports all sessions
 *   bun run src/export.ts --session <session-id> # exports one session
 *   bun run src/export.ts --list                 # lists all sessions
 */

import { parseArgs } from "util";
import { getDb, getAllSessions, getSessionTurns } from "./db.js";
import { join } from "path";
import { mkdirSync, writeFileSync } from "fs";

const { values } = parseArgs({
  args: Bun.argv.slice(2),
  options: {
    session: { type: "string" },
    list:    { type: "boolean", default: false },
    outdir:  { type: "string", default: "./analysis/sessions" },
  },
  strict: true,
});

const db = getDb();

if (values.list) {
  const sessions = getAllSessions(db);
  if (sessions.length === 0) {
    console.log("No sessions found. Run the harness first:\n  bun run src/harness.ts");
    process.exit(0);
  }
  console.log(`\n${"ID".padEnd(38)} ${"Name".padEnd(28)} ${"Model".padEnd(30)} ${"Status".padEnd(10)} Turns`);
  console.log("─".repeat(120));
  for (const s of sessions) {
    const turns = getSessionTurns(db, s.id);
    const lastTurn = turns[turns.length - 1];
    const ctxPct = lastTurn ? (lastTurn.ctxPct * 100).toFixed(1) + "%" : "—";
    console.log(
      `${s.id.padEnd(38)} ${(s.name ?? "—").padEnd(28)} ${s.model.padEnd(30)} ${s.status.padEnd(10)} ${turns.length} (${ctxPct})`
    );
  }
  console.log();
  process.exit(0);
}

const outDir = values.outdir ?? "./analysis/sessions";
mkdirSync(outDir, { recursive: true });

const sessions = values.session
  ? [{ id: values.session } as ReturnType<typeof getAllSessions>[number]]
  : getAllSessions(db);

if (sessions.length === 0) {
  console.log("No sessions found. Run the harness first:\n  bun run src/harness.ts");
  process.exit(0);
}

for (const s of sessions) {
  const turns = getSessionTurns(db, s.id);
  if (turns.length === 0) continue;

  const slug = s.id.slice(0, 8);

  // JSON
  writeFileSync(
    join(outDir, `${slug}.json`),
    JSON.stringify({ session: s, turns }, null, 2)
  );

  // CSV
  const csvHeader = [
    "turn_index", "input_tokens", "output_tokens", "cumulative_tokens",
    "ctx_pct", "latency_ms", "stop_reason",
    "self_correction_count", "repetition_score", "output_density",
  ].join(",");

  const csvRows = turns.map((t) =>
    [
      t.turnIndex, t.inputTokens, t.outputTokens, t.cumulativeTokens,
      t.ctxPct.toFixed(6), t.latencyMs, t.stopReason ?? "",
      t.selfCorrectionCount, t.repetitionScore.toFixed(6), t.outputDensity.toFixed(6),
    ].join(",")
  );

  writeFileSync(join(outDir, `${slug}.csv`), [csvHeader, ...csvRows].join("\n"));

  console.log(`Exported session ${s.id} → ${outDir}/${slug}.{json,csv}  (${turns.length} turns)`);
}
