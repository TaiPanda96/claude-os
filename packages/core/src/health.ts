import type { Turn } from "./types.js";
import { qualityForTurn, QUALITY_FLOOR } from "./domain/quality-proxy.js";

export interface SessionHealthStats {
  currentQuality: number;
  recentTrend: "rising" | "flat" | "declining";
  inflectionCtxPct: number | null;   // percentage (0–100)
  turnsToInflection: number | null;  // projected turns until quality crosses QUALITY_FLOOR
  peakQuality: number;
  peakCtxPct: number;                // percentage (0–100)
}

export function computeSessionHealthStats(turns: Turn[]): SessionHealthStats {
  const empty: SessionHealthStats = {
    currentQuality: 0,
    recentTrend: "flat",
    inflectionCtxPct: null,
    turnsToInflection: null,
    peakQuality: 0,
    peakCtxPct: 0,
  };

  const valid = turns.filter((t) => t.ctxPct <= 1.0);
  if (valid.length === 0) return empty;

  const qualities = valid.map(qualityForTurn);
  const ctxPcts = valid.map((t) => Math.round(t.ctxPct * 1000) / 10);

  // Peak — skip first 3 warm-up turns
  let peakQuality = 0;
  let peakCtxPct = 0;
  for (let i = Math.min(3, valid.length - 1); i < valid.length; i++) {
    if (qualities[i]! > peakQuality) {
      peakQuality = qualities[i]!;
      peakCtxPct = ctxPcts[i]!;
    }
  }

  // Inflection — rolling linear regression (matches notebook find_inflection)
  let inflectionCtxPct: number | null = null;
  if (valid.length >= 6) {
    const w = Math.max(3, Math.floor(valid.length / 5));
    let prevNeg = false;
    for (let i = w; i < valid.length; i++) {
      const xs = ctxPcts.slice(i - w, i);
      const ys = qualities.slice(i - w, i);
      const n = xs.length;
      const sumX = xs.reduce((s, v) => s + v, 0);
      const sumY = ys.reduce((s, v) => s + v, 0);
      const sumXY = xs.reduce((s, v, j) => s + v * ys[j]!, 0);
      const sumX2 = xs.reduce((s, v) => s + v * v, 0);
      const denom = n * sumX2 - sumX * sumX;
      const slope = denom !== 0 ? (n * sumXY - sumX * sumY) / denom : 0;
      if (slope < 0 && prevNeg) {
        inflectionCtxPct = ctxPcts[i - 1]!;
        break;
      }
      prevNeg = slope < 0;
    }
  }

  // Recent trend — slope over last 10 turns
  const tail = qualities.slice(-10);
  const trendSlope = tail.length >= 2
    ? (tail[tail.length - 1]! - tail[0]!) / tail.length
    : 0;
  const recentTrend =
    trendSlope > 0.01 ? "rising" : trendSlope < -0.01 ? "declining" : "flat";

  const currentQuality = qualities[qualities.length - 1]!;

  // turnsToInflection — linear extrapolation
  let turnsToInflection: number | null = null;
  if (trendSlope < -0.01 && currentQuality > QUALITY_FLOOR) {
    const t = (QUALITY_FLOOR - currentQuality) / trendSlope;
    turnsToInflection = t > 0 ? Math.round(t) : null;
  }

  return { currentQuality, recentTrend, inflectionCtxPct, turnsToInflection, peakQuality, peakCtxPct };
}
