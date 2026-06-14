import { readFileSync } from "node:fs";
import { basename } from "node:path";
import {
  AssistantRecord,
  MODEL_CONTEXT_WINDOWS,
  UserRecord,
  Database,
  computeGCState,
} from "../types.js";
import { resolveProjectId } from "../db.js";
import { bigramOverlap } from "../utils/bigram-overlap.js";
import { countSelfCorrections } from "../utils/count-self-corrections.js";

export interface IngestResult {
  /** Session number denotes the given session ingested */
  sessions: number;
  /** The number of turns output for a given session */
  turns: number;
  skipped: number;
}

/**
 * ── Ingest one JSONL file ────────────────────────────────────────────────────
 * @param db - db instance from SQL lite
 * @param filePath - file path
 * @param { verbose } - prints extra logging on last turn usage metadata
 * @returns
 */
export function ingestJsonLFile(
  db: Database,
  filePath: string,
  {
    verbose = true,
  }: {
    verbose: boolean;
  },
): IngestResult {
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

    const projectId = cwd ? resolveProjectId(db, cwd) : null;

    // Upsert session
    db.prepare(
      `
      INSERT INTO sessions (id, name, model, ctx_window, created_at, last_active_at, status, outcome_status, forked_from, project_id)
      VALUES ($id, $name, $model, $ctxWindow, $createdAt, $lastActiveAt, 'active', 'unresolved', null, $projectId)
      ON CONFLICT(id) DO UPDATE SET last_active_at = excluded.last_active_at, model = excluded.model,
        project_id = COALESCE(excluded.project_id, project_id)
    `,
    ).run({
      $id: sessionId,
      $name: name,
      $model: model,
      $ctxWindow: ctxWindow,
      $createdAt: createdAt,
      $lastActiveAt: lastActiveAt,
      $projectId: projectId,
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
      // Clamp at 1.0: values above 1 indicate an unknown model window (falls back to 200k
      // default) where the actual window is larger. Storing raw >1 values corrupts metrics.
      const ctxPct = Math.min(effectiveInput / ctxWindow, 1.0);

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
        .filter((b: { type: string }) => b.type === "text")
        .map((b: { text?: string }) => b.text ?? "")
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

    if (verbose) {
      const lastTurn = turns[turns.length - 1]!;
      const u = lastTurn.message.usage;
      const effectiveInput =
        u.input_tokens +
        (u.cache_read_input_tokens ?? 0) +
        (u.cache_creation_input_tokens ?? 0);
      const ctxPct = Math.min(effectiveInput / ctxWindow, 1.0);
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
