import React, { useMemo } from "react";
import { Turn, GCEvent, GC_TEXT } from "../../types.js";
import { computeQuality, sessionSummaryStats } from "../../quality.js";
import { tokens } from "../../theme.js";

const styles: Record<string, React.CSSProperties> = {
  container: {
    display: "flex",
    gap: 0,
    borderBottom: `0.5px solid ${tokens.border}`,
    background: tokens.void,
    flexShrink: 0,
  },
  stat: {
    flex: 1,
    padding: `${tokens.sp2}px ${tokens.sp6}px`,
    borderRight: `0.5px solid ${tokens.surface1}`,
  },
  label: {
    fontSize: tokens.fsMicro,
    color: tokens.muted,
    textTransform: "uppercase",
    letterSpacing: "0.06em",
    marginBottom: tokens.sp1,
    fontFamily: tokens.fontMono,
  },
  value: {
    fontSize: tokens.fsSection,
    fontWeight: 600,
    fontFamily: tokens.fontMono,
    fontVariantNumeric: "tabular-nums",
    lineHeight: 1,
    marginBottom: 3,
  },
  sub: {
    fontSize: tokens.fsMicro,
    color: tokens.muted,
    fontFamily: tokens.fontMono,
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
    return sessionSummaryStats(
      points,
      firstEvent ? Math.min(Math.round(firstEvent.ctx_pct_at_trigger * 1000) / 10, 100) : null,
      firstEvent?.gc_type ?? null,
    );
  }, [turns, gcEvents]);

  const trendSymbol =
    stats.recentTrend === "rising" ? "↑" : stats.recentTrend === "declining" ? "↓" : "→";
  const trendColor =
    stats.recentTrend === "rising"
      ? GC_TEXT.clean
      : stats.recentTrend === "declining"
        ? GC_TEXT.hard_gc
        : tokens.text;
  const deltaColor =
    stats.qualityDelta >= 0
      ? GC_TEXT.clean
      : stats.qualityDelta < -0.2
        ? GC_TEXT.hard_gc
        : GC_TEXT.soft_gc;

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
      color: stats.inflectionCtxPct != null ? GC_TEXT.soft_gc : tokens.muted,
      sub: stats.inflectionCtxPct != null ? "sustained quality drop" : "quality held throughout",
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
            ? GC_TEXT.hard_gc
            : GC_TEXT.soft_gc
          : tokens.muted,
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
          ? GC_TEXT.hard_gc
          : stats.avgMarginalDensity > 20
            ? GC_TEXT.soft_gc
            : GC_TEXT.clean,
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
          <div style={{ ...styles.value, color: item.color ?? tokens.highlight }}>{item.value}</div>
          {item.sub && <div style={styles.sub}>{item.sub}</div>}
        </div>
      ))}
    </div>
  );
}
