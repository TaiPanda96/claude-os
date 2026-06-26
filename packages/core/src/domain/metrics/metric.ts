import type { GCState } from "../gc-state.js";
import type { MetricContext } from "./metric-context.js";

/**
 * The efficiency-curve metrics. The calculation for each lives in METRIC_CALCULATORS
 * (metric-calculators.ts); the renderer attaches presentation metadata keyed by the same
 * union, so the two layers stay in 1:1 correspondence without sharing presentation here.
 */
export type Metric = "quality" | "marginalDensity" | "workEfficiency";

/** A single metric's value at one turn: the true raw quantity and its plotted [0–1] form. */
export interface MetricValue {
  raw: number;
  scaled: number;
}

/**
 * One row of efficiency-curve data. Metric values are keyed by Metric so consumers stay
 * generic over the metric set rather than hard-coding a field per metric.
 */
export interface ChartPoint {
  turnIndex: number;
  ctxPct: number; // percentage (0–100)
  gcState: GCState;
  metrics: Record<Metric, MetricValue>;
}

/**
 * Declarative calculation for one metric — the single source of truth for HOW it is computed.
 * computeMetrics walks these. Adding a metric is one entry in METRIC_CALCULATORS, not an edit
 * to the engine.
 */
export interface MetricCalculator {
  key: Metric;
  /** Per-turn raw series for this metric, over the shared context. */
  computeRaw: (ctx: MetricContext) => number[];
  /** Normalise a raw value into the plotted [0–1] range. */
  scale: (raw: number) => number;
}
