import { Metric } from "./quality";
import { tokens } from "./theme";

interface MetricMeta {
  label: string;
  signal: string;
  formula: string;
  watchFor: string;
  yLabel: string;
  color: string;
}

export const METRIC_CONFIG: Record<Metric, MetricMeta> = {
  quality: {
    label: "Output Quality",
    signal: "Is Claude degrading as context fills?",
    formula: "0.5 × output density  +  0.3 × (1 − self-corrections)  +  0.2 × (1 − repetition)",
    watchFor: "Sustained drops past 60% ctx — earlier the drop, the more context is hurting output",
    yLabel: "quality score  [0–1]",
    color: tokens.text,
  },
  marginalDensity: {
    label: "Context Bloat Rate",
    signal: "How fast is context inflating vs. useful output?",
    formula: "new ctx tokens introduced this turn  ÷  output tokens produced",
    watchFor: "Rising ratio → context growing faster than work — approaching diminishing returns",
    yLabel: "bloat score (vs. 8× anchor)  [0–1]",
    color: "#bf5af2",
  },
  workEfficiency: {
    label: "Token Cost / Artifact",
    signal: "Are meaningful turns getting more expensive to produce?",
    formula: "new context tokens (trailing 10 turns)  ÷  useful turns in that window",
    watchFor: "Rising curve = GC pressure — context grows faster than useful output appears",
    yLabel: "token cost / artifact  [0–1, log]",
    color: "#0a84ff",
  },
};
