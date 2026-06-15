import { Turn } from "./types.js";
import {
  qualityForTurn,
  QUALITY_FLOOR,
  MARGINAL_DENSITY_ANCHOR,
  WORK_EFFICIENCY_FLOOR,
  WORK_EFFICIENCY_CEIL,
} from "@claude-os/core/domain/quality-proxy.js";

export type Metric = "quality" | "marginalDensity" | "workEfficiency";

// Trailing window (in turns) for the token-cost-per-artifact metric. Matches the
// recent-trend window used in sessionSummaryStats so both read "recent" the same.
const WORK_WINDOW = 10;

export interface ChartPoint {
  turnIndex: number;
  ctxPct: number; // percentage (0–100)
  gcState: string;
  // quality proxy (0–1 normalized)
  quality: number;
  outputDensity: number;
  // context bloat rate: new context tokens introduced / output tokens (raw, then anchor-scaled)
  marginalDensityRaw: number;
  marginalDensity: number; // 0–1, scaled vs MARGINAL_DENSITY_ANCHOR
  // token cost / artifact: trailing-window new context tokens / useful turns (raw, then log-scaled)
  workEfficiencyRaw: number; // new-context tokens-per-artifact over the trailing window
  workEfficiency: number; // 0–1 log-scaled (higher = worse efficiency)
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
  currentWorkEfficiency: number; // trailing-window new-ctx tokens per artifact, latest turn
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
  // No over-window filter: ctx_pct is already clamped to ≤1.0 at ingest
  // (see computeTurnMetrics), so every turn here is in-range.

  // ── Quality proxy — fixed-anchor scaling ─────────────────────────────────
  // output_density is scaled against a fixed empirical ceiling rather than the
  // per-session min-max so that absolute magnitude is preserved across sessions.

  // ── Per-turn new context ─────────────────────────────────────────────────
  // effectiveInput[i] = cumulativeTokens[i] - outputTokens[i]  (context-window
  //   tokens fed to the model that turn). Its turn-over-turn growth is the new
  //   context introduced that turn — shared by both metrics below.
  // Turn 0 reads 0: its context is the fixed base prompt (system prompt + tool
  // defs + CLAUDE.md), a one-time cost, not bloat introduced by the session.
  const effectiveInputs = turns.map(
    (t) => t.cumulativeTokens - t.outputTokens,
  );
  const newCtxTokens = turns.map((t, i) =>
    i === 0 ? 0 : Math.max(0, effectiveInputs[i]! - effectiveInputs[i - 1]!),
  );

  // ── Context bloat rate ───────────────────────────────────────────────────
  // marginalDensityRaw[i] = newContextTokens[i] / outputTokens[i]
  const marginalRaw = turns.map((t, i) => {
    if (i === 0) return 0; // baseline context, not bloat
    if (t.outputTokens > 0) return newCtxTokens[i]! / t.outputTokens;
    // Context grew with zero output is the worst case, not the best — saturate
    // at the anchor rather than reporting 0 (a guard at 0 would invert the signal).
    return newCtxTokens[i]! > 0 ? MARGINAL_DENSITY_ANCHOR : 0;
  });
  // Fixed-anchor scaling (not per-session min-max) so the curve is comparable
  // across sessions and immune to a single outlier flattening everything else.
  const marginalN = marginalRaw.map((v) =>
    Math.min(1, v / MARGINAL_DENSITY_ANCHOR),
  );

  // ── Token cost / artifact ─────────────────────────────────────────────────
  // "Artifact" = a turn whose output is at or above the *running* (prefix)
  // median output — a causal threshold, so a turn's classification never depends
  // on turns that haven't happened yet (the old whole-session median did).
  // workEfficiencyRaw[i] = new context added over a trailing window
  //   ÷ artifacts produced in that window = marginal token cost per useful turn.
  // Unlike a cumulative average (which climbs ~linearly with turn count for any
  // session), this stays flat while healthy and rises only when context grows
  // faster than useful output appears.
  const outputs = turns.map((t) => t.outputTokens);
  const isArtifact = turns.map((t, i) => {
    const prefix = outputs.slice(0, i + 1).sort((a, b) => a - b);
    const median = prefix[Math.floor((prefix.length - 1) / 2)] ?? 0;
    return t.outputTokens >= median;
  });
  const workRaw = turns.map((_, i) => {
    const lo = Math.max(0, i - WORK_WINDOW + 1);
    let ctxSum = 0;
    let artifacts = 0;
    for (let k = lo; k <= i; k++) {
      ctxSum += newCtxTokens[k]!;
      if (isArtifact[k]!) artifacts++;
    }
    // 0 artifacts in the window = maximally inefficient: surface the full window
    // cost (denominator floored at 1) rather than dividing by zero.
    return ctxSum / Math.max(1, artifacts);
  });
  // Log scale: tokens-per-artifact spans orders of magnitude, so a fixed anchor
  // pair (floor→0, ceil→1) keeps the curve readable and cross-session comparable.
  const workN = workRaw.map((v) =>
    logScale(v, WORK_EFFICIENCY_FLOOR, WORK_EFFICIENCY_CEIL),
  );

  return turns.map((t, i) => ({
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

// Log-scale a raw value between two anchors → [0, 1]. floor and below map to 0,
// ceil and above to 1, the geometric midpoint to 0.5. Used where the raw quantity
// spans orders of magnitude (token cost / artifact) and linear scaling would
// crush the low end.
function logScale(value: number, floor: number, ceil: number): number {
  const lv = Math.log10(Math.max(1, value));
  const lo = Math.log10(floor);
  const hi = Math.log10(ceil);
  if (hi <= lo) return 0;
  return Math.min(1, Math.max(0, (lv - lo) / (hi - lo)));
}
