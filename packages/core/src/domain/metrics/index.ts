// Efficiency-curve metrics — calculation only (presentation lives in the renderer's
// metric-config.ts). Each pure function is a single-responsibility module so it can be
// unit-tested in isolation; METRIC_CALCULATORS wires them declaratively and computeMetrics
// is the generic engine that walks the registry.

export type { Metric, MetricValue, MetricCalculator, ChartPoint } from "./metric.js";
export type { MetricContext } from "./metric-context.js";
export type { MetricTurn } from "./metric-turn.js";
export { METRIC_CALCULATORS } from "./metric-calculators.js";
export { computeMetrics, buildMetricContext } from "./compute-metrics.js";
export { sessionSummaryStats } from "./session-stats.js";
export type { SessionStats } from "./session-stats.js";
export { effectiveInputs, newContextTokens } from "./new-context-tokens.js";
export { marginalDensityRaw, scaleMarginalDensity } from "./marginal-density.js";
export { classifyArtifacts } from "./artifacts.js";
export { workEfficiencyRaw, scaleWorkEfficiency, WORK_WINDOW } from "./work-efficiency.js";
export { logScale } from "./log-scale.js";
