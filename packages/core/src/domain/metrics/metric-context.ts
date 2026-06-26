import type { MetricTurn } from "./metric-turn.js";

/**
 * Per-session series derived once and handed to every metric's `computeRaw`, so the
 * cross-turn metrics (bloat rate, token cost / artifact) don't each recompute them.
 */
export interface MetricContext {
  turns: MetricTurn[];
  /** New context tokens introduced per turn (turn-over-turn effective-input growth). */
  newCtxTokens: number[];
  /** Whether each turn's output clears the running-median "useful turn" bar. */
  isArtifact: boolean[];
}
