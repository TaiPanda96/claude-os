import { readFileSync } from "node:fs";
import { basename } from "node:path";
import { AssistantRecord, MODEL_CONTEXT_WINDOWS, UserRecord, Database, GCState } from "../types.js";
import { resolveProjectId, upsertSession } from "../db.js";
import { computeTurnMetrics, recordTurn } from "./record-turn.js";

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
    turns.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());

    const model = turns[0]?.message.model ?? "claude-sonnet-4-6";
    const ctxWindow = MODEL_CONTEXT_WINDOWS[model] ?? 200_000;
    const createdAt = new Date(turns[0]?.timestamp ?? Date.now()).getTime();
    const lastActiveAt = new Date(turns[turns.length - 1]?.timestamp ?? Date.now()).getTime();
    const cwd = turns[0]?.cwd ?? "";
    const name = basename(cwd) || null;
    const projectId = cwd ? resolveProjectId(db, cwd) : null;

    upsertSession(db, {
      id: sessionId,
      name,
      model,
      ctxWindow,
      createdAt,
      lastActiveAt,
      status: "active",
      outcomeStatus: "unresolved",
      forkedFrom: null,
      projectId,
    });
    sessionsInserted++;

    let prevOutputText = "";
    let prevGCState = "clean" as GCState;

    for (let i = 0; i < turns.length; i++) {
      const record = turns[i]!;
      const u = record.message.usage;
      const cacheReadTokens = u.cache_read_input_tokens ?? 0;
      const cacheCreationTokens = u.cache_creation_input_tokens ?? 0;

      const userRecord = record.parentUuid ? userByUuid.get(record.parentUuid) : undefined;
      const latencyMs = userRecord
        ? new Date(record.timestamp).getTime() - new Date(userRecord.timestamp).getTime()
        : 0;

      const outputText = record.message.content
        .filter((b: { type: string }) => b.type === "text")
        .map((b: { text?: string }) => b.text ?? "")
        .join("\n");

      const turn = computeTurnMetrics({
        id: record.uuid,
        sessionId,
        turnIndex: i,
        inputTokens: u.input_tokens,
        outputTokens: u.output_tokens,
        cacheReadTokens,
        cacheCreationTokens,
        outputText,
        prevOutputText,
        latencyMs,
        stopReason: record.message.stop_reason,
        createdAt: new Date(record.timestamp).getTime(),
        model,
        cwd,
      });

      const { inserted, gcState } = recordTurn(db, turn, prevGCState);
      if (inserted) {
        turnsInserted++;
      } else {
        turnsSkipped++;
      }

      prevGCState = gcState;
      prevOutputText = outputText;
    }

    if (verbose) {
      const lastTurn = turns[turns.length - 1]!;
      const u = lastTurn.message.usage;
      const effectiveInput =
        u.input_tokens + (u.cache_read_input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0);
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
