import type { Database, Turn, GCState } from "../types.js";
import { computeGCState } from "../types.js";
import { resolveContextWindow } from "../domain/resolve-context-window.js";
import { bigramOverlap } from "../utils/bigram-overlap.js";
import { countSelfCorrections } from "../utils/count-self-corrections.js";
import { v4 as uuidv4 } from "uuid";

export interface RawTurnInput {
  /** Caller-supplied id. Ingest uses the JSONL record uuid; wrapper uses a fresh uuid.
   *  Dedup is enforced by the UNIQUE index on (session_id, turn_index), not by this id. */
  id?: string;
  sessionId: string;
  turnIndex: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
  outputText: string;
  prevOutputText: string;
  latencyMs: number;
  stopReason: string | null;
  createdAt: number;
  model: string;
  cwd: string;
  pricingVersion: string;
}

export interface RecordTurnResult {
  turn: Turn;
  inserted: boolean;
  gcTransitioned: boolean;
  gcState: GCState;
}

/** Derives all Turn fields from raw input using the canonical metric definitions.
 *  Callers that know the session-level window (resolved from the session's max
 *  observed usage) pass it as `sessionCtxWindow` so every turn in a session is
 *  measured against the same window; otherwise it's resolved per turn. */
export function computeTurnMetrics(input: RawTurnInput, sessionCtxWindow?: number): Turn {
  const effectiveInput = input.inputTokens + input.cacheReadTokens + input.cacheCreationTokens;
  const ctxWindow = sessionCtxWindow ?? resolveContextWindow(input.model, effectiveInput);
  const cumulativeTokens = effectiveInput + input.outputTokens;
  // Window is plan-dependent and absent from the JSONL; resolveContextWindow floors
  // it by observed usage, so this clamp is now only a defensive guard.
  const ctxPct = Math.min(effectiveInput / ctxWindow, 1.0);
  const outputDensity = effectiveInput > 0 ? input.outputTokens / effectiveInput : 0;

  return {
    id: input.id ?? uuidv4(),
    sessionId: input.sessionId,
    turnIndex: input.turnIndex,
    inputTokens: input.inputTokens,
    outputTokens: input.outputTokens,
    cumulativeTokens,
    ctxPct,
    latencyMs: input.latencyMs,
    stopReason: input.stopReason,
    createdAt: input.createdAt,
    selfCorrectionCount: countSelfCorrections(input.outputText),
    repetitionScore: bigramOverlap(input.prevOutputText, input.outputText),
    outputDensity,
    cacheReadTokens: input.cacheReadTokens,
    cacheCreationTokens: input.cacheCreationTokens,
    effectiveInputTokens: effectiveInput,
    pricingVersion: input.pricingVersion,
    cwd: input.cwd,
  };
}

/**
 * Persists a turn and, on first GC state transition, its GC event.
 * INSERT OR IGNORE on (session_id, turn_index) makes both the live and backfill
 * paths safe to run over the same session without producing duplicate rows.
 */
export function recordTurn(db: Database, turn: Turn, prevGCState: GCState): RecordTurnResult {
  const result = db
    .prepare(
      `INSERT OR IGNORE INTO turns (
        id, session_id, turn_index, input_tokens, output_tokens, cumulative_tokens,
        ctx_pct, latency_ms, stop_reason, created_at,
        self_correction_count, repetition_score, output_density,
        cache_read_tokens, cache_creation_tokens, effective_input_tokens, pricing_version, cwd
      ) VALUES (
        $id, $sessionId, $turnIndex, $inputTokens, $outputTokens, $cumulativeTokens,
        $ctxPct, $latencyMs, $stopReason, $createdAt,
        $selfCorrectionCount, $repetitionScore, $outputDensity,
        $cacheRead, $cacheCreation, $effectiveInput, $pricingVersion, $cwd
      )`,
    )
    .run({
      $id: turn.id,
      $sessionId: turn.sessionId,
      $turnIndex: turn.turnIndex,
      $inputTokens: turn.inputTokens,
      $outputTokens: turn.outputTokens,
      $cumulativeTokens: turn.cumulativeTokens,
      $ctxPct: turn.ctxPct,
      $latencyMs: turn.latencyMs,
      $stopReason: turn.stopReason,
      $createdAt: turn.createdAt,
      $selfCorrectionCount: turn.selfCorrectionCount,
      $repetitionScore: turn.repetitionScore,
      $outputDensity: turn.outputDensity,
      $cacheRead: turn.cacheReadTokens,
      $cacheCreation: turn.cacheCreationTokens,
      $effectiveInput: turn.effectiveInputTokens,
      $pricingVersion: turn.pricingVersion,
      $cwd: turn.cwd ?? null,
    });

  const inserted = (result as { changes: number }).changes > 0;

  const gcState = computeGCState(turn.ctxPct);
  let gcTransitioned = false;

  if (inserted && gcState !== prevGCState && gcState !== "clean") {
    db.prepare(
      `INSERT OR IGNORE INTO gc_events (id, session_id, gc_type, ctx_pct_at_trigger, created_at)
       VALUES ($id, $sessionId, $gcType, $ctxPct, $createdAt)`,
    ).run({
      $id: `${turn.sessionId}:${turn.turnIndex}:gc`,
      $sessionId: turn.sessionId,
      $gcType: gcState,
      $ctxPct: turn.ctxPct,
      $createdAt: turn.createdAt,
    });
    gcTransitioned = true;
  }

  return { turn, inserted, gcTransitioned, gcState };
}
