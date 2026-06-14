import { Turn } from "./types.js";
import {
  qualityForTurn,
  QUALITY_FLOOR,
} from "@claude-os/core/domain/quality-proxy.js";

export type Metric = "quality" | "marginalDensity" | "workEfficiency";

export interface ChartPoint {
  turnIndex: number;
  ctxPct: number; // percentage (0–100)
  gcState: string;
  // quality proxy (0–1 normalized)
  quality: number;
  outputDensity: number;
  // marginal density: new context tokens introduced / output tokens (raw, then normalized)
  marginalDensityRaw: number;
  marginalDensity: number; // 0–1 normalized
  // work efficiency: cumulative tokens consumed / cumulative high-output turns (raw, then normalized)
  workEfficiencyRaw: number; // tokens-per-artifact at this turn
  workEfficiency: number; // 0–1 normalized (higher = worse efficiency)
}

export interface SessionStats {
  peakQuality: number;
  peakCtxPct: number;
  inflectionCtxPct: number | null;
  recentTrend: "rising" | "flat" | "declining";
  qualityDelta: number;
  firstGCCtxPct: number | null;
  firstGCType: string | null;
  avgMarginalDensity: number; // avg new-ctx-tokens per output token
  currentWorkEfficiency: number; // tokens-per-artifact at end of session
  // Phase 3 — proactive degradation signal
  currentQuality: number; // quality at the most recent turn
  turnsToInflection: number | null; // projected turns until quality crosses QUALITY_FLOOR
}

/**
 * Compute quality and related metrics for each turn in a session, based on the turn metadata.
 * @param turns - An array of Turn objects representing the turns in a session, with metadata such as token counts and context percentages.
 * @returns An array of ChartPoint objects containing the computed quality and related metrics for each turn.
 */
export function computeQuality(turns: Turn[]): ChartPoint[] {
  if (turns.length === 0) return [];
  const validTurns = turns.filter((t) => t.ctxPct <= 1.0);
  if (validTurns.length === 0) return [];

  // ── Quality proxy — fixed-anchor scaling ─────────────────────────────────
  // output_density is scaled against a fixed empirical ceiling rather than the
  // per-session min-max so that absolute magnitude is preserved across sessions.

  // ── Marginal density ─────────────────────────────────────────────────────
  // effectiveInput[i] = cumulativeTokens[i] - outputTokens[i]
  // newContextTokens[i] = effectiveInput[i] - effectiveInput[i-1]
  // marginalDensityRaw[i] = newContextTokens[i] / outputTokens[i]
  const effectiveInputs = validTurns.map(
    (t) => t.cumulativeTokens - t.outputTokens,
  );
  const marginalRaw = validTurns.map((t, i) => {
    const prev = i === 0 ? 0 : effectiveInputs[i - 1]!;
    const newCtx = Math.max(0, effectiveInputs[i]! - prev);
    return t.outputTokens > 0 ? newCtx / t.outputTokens : 0;
  });
  const marginalN = normalize(marginalRaw);

  // ── Work efficiency ───────────────────────────────────────────────────────
  // "Useful artifact" = turn in the top 50% of output_tokens for this session.
  // workEfficiencyRaw[i] = cumulative effectiveInput up to i / artifact count up to i
  // Higher = more tokens spent per artifact = degrading efficiency.
  const medianOutput =
    [...validTurns.map((t) => t.outputTokens)].sort((a, b) => a - b)[
      Math.floor(validTurns.length / 2)
    ] ?? 0;

  let cumulativeInput = 0;
  let artifactCount = 0;
  const workRaw = validTurns.map((t, i) => {
    cumulativeInput += effectiveInputs[i]!;
    if (t.outputTokens >= medianOutput) artifactCount++;
    return artifactCount > 0 ? cumulativeInput / artifactCount : 0;
  });
  const workN = normalize(workRaw);

  return validTurns.map((t, i) => ({
    turnIndex: t.turnIndex,
    ctxPct: Math.round(t.ctxPct * 1000) / 10,
    gcState:
      t.ctxPct >= 0.8 ? "hard_gc" : t.ctxPct >= 0.6 ? "soft_gc" : "clean",
    quality: qualityForTurn(t),
    outputDensity: t.outputDensity ?? 0,
    marginalDensityRaw: marginalRaw[i]!,
    marginalDensity: Math.round(marginalN[i]! * 100) / 100,
    workEfficiencyRaw: Math.round(workRaw[i]!),
    workEfficiency: Math.round(workN[i]! * 100) / 100,
  }));
}

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

  // Peak — skip first 3 warm-up turns
  const eligible = points.slice(Math.min(3, points.length - 1));
  const peak = eligible.reduce(
    (best, p) => (p.quality > best.quality ? p : best),
    eligible[0]!,
  );

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

  // Recent trend — slope over last 10 turns
  const tail = points.slice(-10);
  const slope =
    tail.length >= 2
      ? (tail[tail.length - 1]!.quality - tail[0]!.quality) / tail.length
      : 0;
  const recentTrend =
    slope > 0.01 ? "rising" : slope < -0.01 ? "declining" : "flat";

  const recentAvg = tail.reduce((s, p) => s + p.quality, 0) / tail.length;

  // Avg marginal density (raw, in tokens) across session
  const avgMarginalDensity =
    points.reduce((s, p) => s + p.marginalDensityRaw, 0) / points.length;

  // Work efficiency at the end of the session (raw tokens-per-artifact)
  const currentWorkEfficiency = points[points.length - 1]!.workEfficiencyRaw;

  const currentQuality = points[points.length - 1]!.quality;

  // turnsToInflection — linear extrapolation from the last 10 quality points.
  // Projects how many more turns until quality crosses QUALITY_FLOOR.
  // Only meaningful when the recent slope is negative; null otherwise.
  let turnsToInflection: number | null = null;
  if (slope < -0.01 && currentQuality > QUALITY_FLOOR) {
    // slope is quality-change-per-turn; solve for turns: floor = current + slope * t
    const t = (QUALITY_FLOOR - currentQuality) / slope;
    turnsToInflection = t > 0 ? Math.round(t) : null;
  }

  return {
    peakQuality: peak.quality,
    peakCtxPct: peak.ctxPct,
    inflectionCtxPct,
    recentTrend,
    qualityDelta: recentAvg - peak.quality,
    firstGCCtxPct,
    firstGCType,
    avgMarginalDensity: Math.round(avgMarginalDensity),
    currentWorkEfficiency,
    currentQuality,
    turnsToInflection,
  };
}

function normalize(values: number[]): number[] {
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min;
  return range === 0
    ? values.map(() => 0.5)
    : values.map((v) => (v - min) / range);
}
