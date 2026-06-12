import React, { useMemo } from "react";
import { Turn, GCEvent, GC_COLOR } from "../types.js";
import { computeQuality, deriveStats } from "../quality.js";

const styles: Record<string, React.CSSProperties> = {
  container: {
    display: "flex",
    gap: 0,
    borderBottom: "1px solid #2c2c2e",
    background: "#0d0d0f",
    flexShrink: 0,
  },
  stat: {
    flex: 1,
    padding: "10px 20px",
    borderRight: "1px solid #1c1c1e",
  },
  label: {
    fontSize: 10,
    color: "#48484a",
    textTransform: "uppercase",
    letterSpacing: "0.06em",
    marginBottom: 4,
    fontFamily: "monospace",
  },
  value: {
    fontSize: 15,
    fontWeight: 600,
    fontFamily: "monospace",
    fontVariantNumeric: "tabular-nums",
    lineHeight: 1,
    marginBottom: 3,
  },
  sub: {
    fontSize: 10,
    color: "#48484a",
    fontFamily: "monospace",
  },
};

interface Props {
  turns: Turn[];
  gcEvents: GCEvent[];
}

export function SessionSummary({ turns, gcEvents }: Props) {
  const stats = useMemo(() => {
    const points = computeQuality(turns);
    const firstEvent = gcEvents[0] ?? null;
    return deriveStats(
      points,
      firstEvent
        ? Math.min(Math.round(firstEvent.ctx_pct_at_trigger * 1000) / 10, 100)
        : null,
      firstEvent?.gc_type ?? null,
    );
  }, [turns, gcEvents]);

  const trendSymbol =
    stats.recentTrend === "rising"
      ? "↑"
      : stats.recentTrend === "declining"
        ? "↓"
        : "→";
  const trendColor =
    stats.recentTrend === "rising"
      ? GC_COLOR.clean
      : stats.recentTrend === "declining"
        ? GC_COLOR.hard_gc
        : "#aeaeb2";
  const deltaColor =
    stats.qualityDelta >= 0
      ? GC_COLOR.clean
      : stats.qualityDelta < -0.2
        ? GC_COLOR.hard_gc
        : GC_COLOR.soft_gc;

  const items: {
    label: string;
    value: string;
    color?: string;
    sub?: string;
  }[] = [
    {
      label: "Peak quality",
      value: stats.peakQuality.toFixed(2),
      sub: `@ ${Math.min(stats.peakCtxPct, 100).toFixed(1)}% ctx`,
    },
    {
      label: "Inflection",
      value:
        stats.inflectionCtxPct != null
          ? `${Math.min(stats.inflectionCtxPct, 100).toFixed(1)}% ctx`
          : "none detected",
      color: stats.inflectionCtxPct != null ? GC_COLOR.soft_gc : "#48484a",
      sub:
        stats.inflectionCtxPct != null
          ? "sustained quality drop"
          : "quality held throughout",
    },
    {
      label: "First GC crossing",
      value:
        stats.firstGCCtxPct != null
          ? `${Math.min(stats.firstGCCtxPct, 100).toFixed(1)}% ctx`
          : "none",
      color:
        stats.firstGCCtxPct != null
          ? stats.firstGCType === "hard_gc"
            ? GC_COLOR.hard_gc
            : GC_COLOR.soft_gc
          : "#48484a",
      sub: stats.firstGCType ?? "session stayed clean",
    },
    {
      label: "Δ quality",
      value: `${stats.qualityDelta >= 0 ? "+" : ""}${stats.qualityDelta.toFixed(2)}`,
      color: deltaColor,
      sub: "peak → recent avg",
    },
    {
      label: "Trajectory",
      value: `${trendSymbol} ${stats.recentTrend}`,
      color: trendColor,
      sub: "last 10 turns",
    },
    {
      label: "Marginal density",
      value: `${stats.avgMarginalDensity}x`,
      color:
        stats.avgMarginalDensity > 50
          ? GC_COLOR.hard_gc
          : stats.avgMarginalDensity > 20
            ? GC_COLOR.soft_gc
            : GC_COLOR.clean,
      sub: "avg new ctx / output tok",
    },
    {
      label: "Work efficiency",
      value: stats.currentWorkEfficiency.toLocaleString(),
      color: "#0a84ff",
      sub: "tokens per artifact",
    },
  ];

  return (
    <div style={styles.container}>
      {items.map((item) => (
        <div key={item.label} style={styles.stat}>
          <div style={styles.label}>{item.label}</div>
          <div style={{ ...styles.value, color: item.color ?? "#f2f2f7" }}>
            {item.value}
          </div>
          {item.sub && <div style={styles.sub}>{item.sub}</div>}
        </div>
      ))}
    </div>
  );
}
