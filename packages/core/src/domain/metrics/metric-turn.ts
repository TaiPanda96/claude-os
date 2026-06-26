import type { QualitySignals } from "../quality-proxy.js";

/**
 * The minimal per-turn signal the metric calculations read. Declared structurally (and
 * extending QualitySignals) — like TrendPoint and QualitySignals elsewhere in domain — so
 * any richer Turn shape (core's nominal Turn, the renderer's local Turn) satisfies it
 * without the calculation layer having to import a nominal type across a package boundary.
 */
export interface MetricTurn extends QualitySignals {
  turnIndex: number;
  outputTokens: number;
  cumulativeTokens: number;
  ctxPct: number; // 0–1 fraction of the context window
}
