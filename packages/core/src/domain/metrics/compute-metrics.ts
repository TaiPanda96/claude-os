import { computeGCState } from "../gc-state.js";
import type { ChartPoint, Metric, MetricValue } from "./metric.js";
import type { MetricContext } from "./metric-context.js";
import type { MetricTurn } from "./metric-turn.js";
import { METRIC_CALCULATORS } from "./metric-calculators.js";
import { newContextTokens } from "./new-context-tokens.js";
import { classifyArtifacts } from "./artifacts.js";

/**
 * Build the shared per-session series every metric draws on, so the cross-turn metrics
 * (bloat rate, token cost / artifact) don't each recompute them.
 * @param turns - the session's turns, in order.
 */
export function buildMetricContext(turns: MetricTurn[]): MetricContext {
  return {
    turns,
    newCtxTokens: newContextTokens(turns),
    isArtifact: classifyArtifacts(turns.map((t) => t.outputTokens)),
  };
}

/**
 * Compute the efficiency-curve data for a session. Generic over METRIC_CALCULATORS: each
 * metric's declared computeRaw/scale is applied here, so adding or changing a metric is a
 * registry edit, not a change to this function.
 * @param turns - the session's turns, in order.
 * @returns one ChartPoint per turn, each carrying every metric's raw + scaled value.
 */
export function computeMetrics(turns: MetricTurn[]): ChartPoint[] {
  if (turns.length === 0) return [];
  // ctx_pct is already clamped to ≤1.0 at ingest (see computeTurnMetrics), so every turn
  // here is in-range — no over-window filter needed.
  const ctx = buildMetricContext(turns);

  // Run each metric's declared calculation once over the whole series. Scaled values are
  // rounded to 2dp for stable plotting; raw values are kept exact for the tooltip/summary.
  const series = {} as Record<Metric, MetricValue[]>;
  for (const key of Object.keys(METRIC_CALCULATORS) as Metric[]) {
    const calc = METRIC_CALCULATORS[key];
    series[key] = calc.computeRaw(ctx).map((raw) => ({
      raw,
      scaled: Math.round(calc.scale(raw) * 100) / 100,
    }));
  }

  return turns.map((t, i) => {
    const metrics = {} as Record<Metric, MetricValue>;
    for (const key of Object.keys(METRIC_CALCULATORS) as Metric[]) {
      metrics[key] = series[key]![i]!;
    }
    return {
      turnIndex: t.turnIndex,
      ctxPct: Math.round(t.ctxPct * 1000) / 10,
      gcState: computeGCState(t.ctxPct),
      metrics,
    };
  });
}
