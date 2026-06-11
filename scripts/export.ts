#!/usr/bin/env bun
/**
 * Exports session turn data to JSON and CSV for notebook analysis.
 *
 * Usage:
 *   bun run export                        # exports all sessions
 *   bun run export --session <session-id> # exports one session
 *   bun run export --list                 # lists all sessions
 */

import { program } from "@commander-js/extra-typings";
import { parseArgs } from "util";
import {
  getDb,
  getAllSessions,
  getSessionTurns,
} from "../packages/core/src/db.js";
import { join } from "path";
import { mkdirSync, writeFileSync } from "fs";

const DEFAULT_OUT_DIR = join(import.meta.dir, "../analysis/sessions");

program
  .name("export")
  .description(
    "Export session turn data to JSON and CSV for notebook analysis. Exports all sessions by default; use --session to specify one.",
  )
  .option("--session <id>", "Export just this session ID")
  .option("--list", "List all sessions without exporting")
  .option("--outdir <path>", "Directory to write output files")
  .action(() => {
    const { values } = parseArgs({
      args: Bun.argv.slice(2),
      options: {
        session: { type: "string" },
        list: { type: "boolean", default: false },
        outdir: { type: "string" },
      },
      strict: true,
    });

    const db = getDb();

    if (values.list) {
      const sessions = getAllSessions(db);
      if (sessions.length === 0) {
        console.log("No sessions found. Run `bun run ingest` first.");
        process.exit(0);
      }
      console.log(
        `\n${"ID".padEnd(38)} ${"Name".padEnd(28)} ${"Model".padEnd(30)} ${"Status".padEnd(10)} Turns`,
      );
      console.log("─".repeat(120));
      for (const s of sessions) {
        const turns = getSessionTurns(db, s.id);
        const lastTurn = turns[turns.length - 1];
        const ctxPct = lastTurn
          ? (lastTurn.ctxPct * 100).toFixed(1) + "%"
          : "—";
        console.log(
          `${s.id.padEnd(38)} ${(s.name ?? "—").padEnd(28)} ${s.model.padEnd(30)} ${s.status.padEnd(10)} ${turns.length} (${ctxPct})`,
        );
      }
      console.log();
      process.exit(0);
    }

    const outDir = values.outdir ?? DEFAULT_OUT_DIR;
    mkdirSync(outDir, { recursive: true });

    const sessions = values.session
      ? [{ id: values.session } as ReturnType<typeof getAllSessions>[number]]
      : getAllSessions(db);

    if (sessions.length === 0) {
      console.log("No sessions found. Run `bun run ingest` first.");
      process.exit(0);
    }

    for (const s of sessions) {
      const turns = getSessionTurns(db, s.id);
      if (turns.length === 0) continue;

      const slug = s.id.slice(0, 8);

      // JSON
      writeFileSync(
        join(outDir, `${slug}.json`),
        JSON.stringify({ session: s, turns }, null, 2),
      );

      // CSV
      const csvHeader = [
        "turn_index",
        "input_tokens",
        "output_tokens",
        "cumulative_tokens",
        "ctx_pct",
        "latency_ms",
        "stop_reason",
        "self_correction_count",
        "repetition_score",
        "output_density",
      ].join(",");

      const csvRows = turns.map((t) =>
        [
          t.turnIndex,
          t.inputTokens,
          t.outputTokens,
          t.cumulativeTokens,
          t.ctxPct.toFixed(6),
          t.latencyMs,
          t.stopReason ?? "",
          t.selfCorrectionCount,
          t.repetitionScore.toFixed(6),
          t.outputDensity.toFixed(6),
        ].join(","),
      );

      writeFileSync(
        join(outDir, `${slug}.csv`),
        [csvHeader, ...csvRows].join("\n"),
      );

      console.log(
        `Exported session ${s.id} → ${outDir}/${slug}.{json,csv}  (${turns.length} turns)`,
      );
    }
  });

program.parse();
