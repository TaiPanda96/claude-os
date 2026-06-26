import { qualityForTurn } from "../quality-proxy.js";
import type { Metric, MetricCalculator } from "./metric.js";
import { marginalDensityRaw, scaleMarginalDensity } from "./marginal-density.js";
import { workEfficiencyRaw, scaleWorkEfficiency } from "./work-efficiency.js";

/**
 * THE single source of truth for how each efficiency-curve metric is calculated. Each entry
 * wires the metric's raw series and its [0–1] scaling from the pure functions in this folder;
 * the per-turn quality proxy reuses qualityForTurn so the chart and the server's /health can't
 * diverge. computeMetrics walks this map; the renderer's METRIC_CONFIG attaches presentation
 * to the same keys. Adding a metric is one entry here.
 */
export const METRIC_CALCULATORS: Record<Metric, MetricCalculator> = {
  quality: {
    key: "quality",
    computeRaw: ({ turns }) => turns.map((t) => qualityForTurn(t)),
    scale: (v) => v, // qualityForTurn already returns 0–1
  },
  marginalDensity: {
    key: "marginalDensity",
    computeRaw: ({ turns, newCtxTokens }) => marginalDensityRaw(turns, newCtxTokens),
    scale: scaleMarginalDensity,
  },
  workEfficiency: {
    key: "workEfficiency",
    computeRaw: ({ newCtxTokens, isArtifact }) => workEfficiencyRaw(newCtxTokens, isArtifact),
    scale: scaleWorkEfficiency,
  },
};
