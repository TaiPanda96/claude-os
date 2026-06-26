import type { Metric } from "@claude-os/core/domain/metrics/index.js";
import { tokens } from "./theme.js";

/**
 * Presentation metadata for one efficiency-curve metric. The *calculation* lives in
 * packages/core (domain/metrics) — this layer only describes how to LABEL and DRAW a metric.
 * The `formula` string is the human-readable echo of the core computeRaw it pairs with.
 */
export interface MetricPresentation {
  label: string;
  signal: string;
  formula: string;
  watchFor: string;
  yLabel: string;
  color: string;
  /** Render a metric's raw value for the tooltip (units, precision). */
  formatRaw: (raw: number) => string;
}

/**
 * The renderer-side presentation registry, keyed by core's Metric union so the compiler
 * forces a presentation entry for every metric the domain computes. Pairs 1:1 with
 * METRIC_CALCULATORS in packages/core — one declares how a metric is shown, the other how
 * it is computed.
 */
export const METRIC_CONFIG: Record<Metric, MetricPresentation> = {
  quality: {
    label: "Output Quality",
    signal: "Is Claude degrading as context fills?",
    formula: "0.5 × output density  +  0.3 × (1 − self-corrections)  +  0.2 × (1 − repetition)",
    watchFor: "Sustained drops past 60% ctx — earlier the drop, the more context is hurting output",
    yLabel: "quality score  [0–1]",
    color: tokens.text,
    formatRaw: (v) => v.toFixed(2),
  },
  marginalDensity: {
    label: "Context Bloat Rate",
    signal: "How fast is context inflating vs. useful output?",
    formula: "new ctx tokens introduced this turn  ÷  output tokens produced",
    watchFor: "Rising ratio → context growing faster than work — approaching diminishing returns",
    yLabel: "bloat score (vs. 8× anchor)  [0–1]",
    color: "#bf5af2",
    formatRaw: (v) => `${v.toFixed(1)}x`,
  },
  workEfficiency: {
    label: "Token Cost / Artifact",
    signal: "Are meaningful turns getting more expensive to produce?",
    formula: "new context tokens (trailing 10 turns)  ÷  useful turns in that window",
    watchFor: "Rising curve = GC pressure — context grows faster than useful output appears",
    yLabel: "token cost / artifact  [0–1, log]",
    color: "#0a84ff",
    formatRaw: (v) => `${Math.round(v).toLocaleString()} tok`,
  },
};
