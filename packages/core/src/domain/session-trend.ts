// Session-level degradation-curve stats — THE single source of truth.
//
// Peak, inflection, recent trend, and the turns-to-inflection projection were
// previously duplicated, with byte-for-byte identical algorithms, between
// packages/core/src/health.ts (computeSessionHealthStats, server-side) and
// apps/desktop/src/renderer/quality.ts (sessionSummaryStats, renderer). Both now
// derive these from here, so the inflection rule / trend window can't silently
// diverge across the wire.
//
// Operates on the minimal signal each caller can supply — per-turn (ctxPct,
// quality) — rather than a nominal Turn/ChartPoint type, so neither side has to
// share its richer shape across the package boundary.

import { QUALITY_FLOOR } from "./quality-proxy.js";

export interface TrendPoint {
  ctxPct: number; // percentage (0–100)
  quality: number; // 0–1
}

export interface SessionTrend {
  currentQuality: number;
  recentTrend: "rising" | "flat" | "declining";
  inflectionCtxPct: number | null; // percentage (0–100)
  turnsToInflection: number | null; // projected turns until quality crosses QUALITY_FLOOR
  peakQuality: number;
  peakCtxPct: number; // percentage (0–100)
  // Recent-trend slope (quality change per turn over the trailing window). Exposed
  // so callers that derive their own recent aggregates (e.g. qualityDelta) reuse
  // the same window rather than recomputing a possibly-divergent one.
  recentSlope: number;
}

// Trailing window (in turns) for the recent-trend slope.
const TREND_WINDOW = 10;

export function computeSessionTrend(points: TrendPoint[]): SessionTrend {
  const empty: SessionTrend = {
    currentQuality: 0,
    recentTrend: "flat",
    inflectionCtxPct: null,
    turnsToInflection: null,
    peakQuality: 0,
    peakCtxPct: 0,
    recentSlope: 0,
  };
  if (points.length === 0) return empty;

  // Peak — skip first 3 warm-up turns
  const eligible = points.slice(Math.min(3, points.length - 1));
  const peak = eligible.reduce((best, p) => (p.quality > best.quality ? p : best), eligible[0]!);

  // Inflection — rolling linear regression, matching the notebook's find_inflection().
  // Window = max(3, n/5) turns. First ctx_pct where slope is negative two windows in a row.
  let inflectionCtxPct: number | null = null;
  if (points.length >= 6) {
    const w = Math.max(3, Math.floor(points.length / 5));
    let prevNeg = false;
    for (let i = w; i < points.length; i++) {
      const slice = points.slice(i - w, i);
      const n = slice.length;
      const sumX = slice.reduce((s, p) => s + p.ctxPct, 0);
      const sumY = slice.reduce((s, p) => s + p.quality, 0);
      const sumXY = slice.reduce((s, p) => s + p.ctxPct * p.quality, 0);
      const sumX2 = slice.reduce((s, p) => s + p.ctxPct * p.ctxPct, 0);
      const denom = n * sumX2 - sumX * sumX;
      const slope = denom !== 0 ? (n * sumXY - sumX * sumY) / denom : 0;
      if (slope < 0 && prevNeg) {
        inflectionCtxPct = points[i - 1]!.ctxPct;
        break;
      }
      prevNeg = slope < 0;
    }
  }

  // Recent trend — slope over last TREND_WINDOW turns
  const tail = points.slice(-TREND_WINDOW);
  const recentSlope =
    tail.length >= 2 ? (tail[tail.length - 1]!.quality - tail[0]!.quality) / tail.length : 0;
  const recentTrend = recentSlope > 0.01 ? "rising" : recentSlope < -0.01 ? "declining" : "flat";

  const currentQuality = points[points.length - 1]!.quality;

  // turnsToInflection — linear extrapolation from the recent slope. Projects how many
  // more turns until quality crosses QUALITY_FLOOR. Only meaningful when declining.
  let turnsToInflection: number | null = null;
  if (recentSlope < -0.01 && currentQuality > QUALITY_FLOOR) {
    const t = (QUALITY_FLOOR - currentQuality) / recentSlope;
    turnsToInflection = t > 0 ? Math.round(t) : null;
  }

  return {
    currentQuality,
    recentTrend,
    inflectionCtxPct,
    turnsToInflection,
    peakQuality: peak.quality,
    peakCtxPct: peak.ctxPct,
    recentSlope,
  };
}
