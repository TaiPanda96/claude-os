import { Turn } from "./types.js";

export interface ChartPoint {
  turnIndex: number;
  ctxPct: number;   // already in percentage (0–100)
  quality: number;  // 0–1
  gcState: string;
  outputDensity: number;
}

function normalize(values: number[]): number[] {
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min;
  return range === 0
    ? values.map(() => 0.5)
    : values.map((v) => (v - min) / range);
}

export function computeQuality(turns: Turn[]): ChartPoint[] {
  if (turns.length === 0) return [];

  const densityN = normalize(turns.map((t) => t.outputDensity ?? 0));
  const scN = normalize(turns.map((t) => t.selfCorrectionCount ?? 0));
  const repN = normalize(turns.map((t) => t.repetitionScore ?? 0));

  return turns.map((t, i) => ({
    turnIndex: t.turnIndex,
    ctxPct: Math.round(t.ctxPct * 1000) / 10,
    quality:
      Math.round(
        (densityN[i]! * 0.5 + (1 - scN[i]!) * 0.3 + (1 - repN[i]!) * 0.2) * 100,
      ) / 100,
    gcState: t.ctxPct >= 0.8 ? "hard_gc" : t.ctxPct >= 0.6 ? "soft_gc" : "clean",
    outputDensity: t.outputDensity ?? 0,
  }));
}

export interface SessionStats {
  peakQuality: number;
  peakCtxPct: number;
  inflectionCtxPct: number | null; // ctx% where sustained decline began
  recentTrend: "rising" | "flat" | "declining";
  qualityDelta: number;            // quality at inflection vs recent avg (negative = drop)
  firstGCCtxPct: number | null;
  firstGCType: string | null;
}

export function deriveStats(points: ChartPoint[], firstGCCtxPct: number | null, firstGCType: string | null): SessionStats {
  if (points.length === 0) {
    return { peakQuality: 0, peakCtxPct: 0, inflectionCtxPct: null, recentTrend: "flat", qualityDelta: 0, firstGCCtxPct, firstGCType };
  }

  // Peak — ignore first 3 turns (warm-up noise)
  const eligible = points.slice(Math.min(3, points.length - 1));
  const peak = eligible.reduce((best, p) => p.quality > best.quality ? p : best, eligible[0]!);

  // Inflection — first point after peak where a 5-turn trailing average is
  // at least 15% below peak and still declining
  let inflectionCtxPct: number | null = null;
  const peakIdx = points.indexOf(peak);
  const WINDOW = 5;
  const THRESHOLD = 0.15;
  for (let i = peakIdx + WINDOW; i < points.length; i++) {
    const window = points.slice(i - WINDOW, i);
    const avg = window.reduce((s, p) => s + p.quality, 0) / window.length;
    if (peak.quality - avg >= THRESHOLD * peak.quality) {
      inflectionCtxPct = points[i]!.ctxPct;
      break;
    }
  }

  // Recent trend — slope over last 10 turns
  const tail = points.slice(-10);
  const slope = tail.length >= 2
    ? (tail[tail.length - 1]!.quality - tail[0]!.quality) / tail.length
    : 0;
  const recentTrend = slope > 0.01 ? "rising" : slope < -0.01 ? "declining" : "flat";

  // Quality delta: peak quality vs trailing 10-turn average
  const recentAvg = tail.reduce((s, p) => s + p.quality, 0) / tail.length;
  const qualityDelta = recentAvg - peak.quality;

  return { peakQuality: peak.quality, peakCtxPct: peak.ctxPct, inflectionCtxPct, recentTrend, qualityDelta, firstGCCtxPct, firstGCType };
}
