import { computeSessionTrend } from "../session-trend.js";
import type { ChartPoint } from "./metric.js";

/**
 * Session-level summary derived from a session's ChartPoints — the headline numbers the
 * activity monitor shows above the curve.
 */
export interface SessionStats {
  peakQuality: number;
  peakCtxPct: number;
  inflectionCtxPct: number | null;
  recentTrend: "rising" | "flat" | "declining";
  qualityDelta: number;
  firstGCCtxPct: number | null;
  firstGCType: string | null;
  avgMarginalDensity: number; // avg new-ctx-tokens per output token
  currentWorkEfficiency: number; // trailing-window new-ctx tokens per artifact, latest turn
  // Phase 3 — proactive degradation signal
  currentQuality: number; // quality at the most recent turn
  turnsToInflection: number | null; // projected turns until quality crosses QUALITY_FLOOR
}

/**
 * Summarise a session's ChartPoints into headline degradation stats. Peak, inflection,
 * recent trend, and the turns-to-inflection projection come from the shared session-trend
 * core (it needs only per-turn ctxPct + quality), so they can't drift from the server's
 * /health computation.
 * @param points - the session's ChartPoints (see computeMetrics).
 * @param firstGCCtxPct - ctx% at the session's first GC crossing, or null.
 * @param firstGCType - the gc_type of that first crossing, or null.
 */
export function sessionSummaryStats(
  points: ChartPoint[],
  firstGCCtxPct: number | null,
  firstGCType: string | null,
): SessionStats {
  const empty: SessionStats = {
    peakQuality: 0,
    peakCtxPct: 0,
    inflectionCtxPct: null,
    recentTrend: "flat",
    qualityDelta: 0,
    firstGCCtxPct,
    firstGCType,
    avgMarginalDensity: 0,
    currentWorkEfficiency: 0,
    currentQuality: 0,
    turnsToInflection: null,
  };
  if (points.length === 0) return empty;

  const trend = computeSessionTrend(
    points.map((p) => ({ ctxPct: p.ctxPct, quality: p.metrics.quality.scaled })),
  );

  // Recent average over the same trailing window the trend slope uses (the last 10), for
  // the peak-relative quality delta.
  const tail = points.slice(-10);
  const recentAvg = tail.reduce((s, p) => s + p.metrics.quality.scaled, 0) / tail.length;

  // Avg marginal density (raw, in tokens) across the session.
  const avgMarginalDensity =
    points.reduce((s, p) => s + p.metrics.marginalDensity.raw, 0) / points.length;

  // Work efficiency at the end of the session (raw tokens-per-artifact).
  const currentWorkEfficiency = points[points.length - 1]!.metrics.workEfficiency.raw;

  return {
    peakQuality: trend.peakQuality,
    peakCtxPct: trend.peakCtxPct,
    inflectionCtxPct: trend.inflectionCtxPct,
    recentTrend: trend.recentTrend,
    qualityDelta: recentAvg - trend.peakQuality,
    firstGCCtxPct,
    firstGCType,
    avgMarginalDensity: Math.round(avgMarginalDensity),
    currentWorkEfficiency: Math.round(currentWorkEfficiency),
    currentQuality: trend.currentQuality,
    turnsToInflection: trend.turnsToInflection,
  };
}
