import React, { useMemo, useState } from "react";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ReferenceLine,
  ResponsiveContainer,
} from "recharts";
import { Turn, GCEvent, GC_COLOR } from "../types.js";
import { ChartPoint, Metric, computeQuality } from "../quality.js";

const METRIC_CONFIG: Record<Metric, { label: string; yLabel: string; description: string; color: string }> = {
  quality: {
    label: "Quality",
    yLabel: "quality proxy",
    description: "0.5 × output density + 0.3 × (1 − self-correction) + 0.2 × (1 − repetition)",
    color: "#636366",
  },
  marginalDensity: {
    label: "Marginal Density",
    yLabel: "new ctx tokens / output tokens",
    description: "New context tokens introduced since last turn ÷ output tokens — cost of incremental context",
    color: "#bf5af2",
  },
  workEfficiency: {
    label: "Work Efficiency",
    yLabel: "tokens per artifact",
    description: "Cumulative tokens consumed ÷ high-output turns produced — rising curve = context bloat",
    color: "#0a84ff",
  },
};

function CustomDot(props: any) {
  const { cx, cy, payload, metric }: { cx: number; cy: number; payload: ChartPoint; metric: Metric } = props;
  const color =
    metric === "quality"
      ? (GC_COLOR[payload.gcState as keyof typeof GC_COLOR] ?? GC_COLOR.clean)
      : METRIC_CONFIG[metric].color;
  return <circle cx={cx} cy={cy} r={3} fill={color} fillOpacity={0.8} stroke="none" />;
}

function CustomTooltip({ active, payload, metric }: any) {
  if (!active || !payload?.length) return null;
  const d = payload[0].payload as ChartPoint;
  const stateColor = GC_COLOR[d.gcState as keyof typeof GC_COLOR] ?? GC_COLOR.clean;
  return (
    <div style={tooltipStyle}>
      <div style={{ color: stateColor, fontWeight: 600, marginBottom: 6 }}>
        {d.ctxPct.toFixed(1)}% context · turn #{d.turnIndex}
      </div>
      <div style={tooltipRow}>
        <span style={tooltipLabel}>quality</span>
        <span style={tooltipValue}>{d.quality.toFixed(2)}</span>
      </div>
      <div style={tooltipRow}>
        <span style={{ ...tooltipLabel, color: METRIC_CONFIG.marginalDensity.color }}>marginal density</span>
        <span style={tooltipValue}>
          {d.marginalDensityRaw.toFixed(1)}x
          <span style={{ color: "#48484a", marginLeft: 4 }}>({d.marginalDensity.toFixed(2)})</span>
        </span>
      </div>
      <div style={tooltipRow}>
        <span style={{ ...tooltipLabel, color: METRIC_CONFIG.workEfficiency.color }}>work efficiency</span>
        <span style={tooltipValue}>
          {d.workEfficiencyRaw.toLocaleString()} tok/artifact
          <span style={{ color: "#48484a", marginLeft: 4 }}>({d.workEfficiency.toFixed(2)})</span>
        </span>
      </div>
    </div>
  );
}

const tooltipStyle: React.CSSProperties = {
  background: "#1c1c1e",
  border: "1px solid #3a3a3c",
  borderRadius: 6,
  padding: "10px 14px",
  fontSize: 12,
  fontFamily: "monospace",
  minWidth: 240,
};
const tooltipRow: React.CSSProperties = { display: "flex", justifyContent: "space-between", gap: 16, marginTop: 3 };
const tooltipLabel: React.CSSProperties = { color: "#636366" };
const tooltipValue: React.CSSProperties = { color: "#f2f2f7" };

type Props = {
  turns: Turn[];
  sessionName?: string;
  gcEvents?: GCEvent[];
};

export function EfficiencyCurve({ turns, sessionName, gcEvents = [] }: Props) {
  const [metric, setMetric] = useState<Metric>("quality");
  const data = useMemo(() => computeQuality(turns), [turns]);

  if (data.length === 0) {
    return <div style={styles.empty}>No turn data</div>;
  }

  const maxCtx = Math.max(...data.map((d) => d.ctxPct));
  const xMax = Math.max(100, Math.ceil(maxCtx / 20) * 20);
  const cfg = METRIC_CONFIG[metric];

  return (
    <div style={styles.container}>
      {/* Title + metric selector */}
      <div style={styles.titleRow}>
        <div style={styles.title}>
          {sessionName ?? "Session"} — Context Efficiency Curve
        </div>
        <div style={styles.metricTabs}>
          {(Object.keys(METRIC_CONFIG) as Metric[]).map((m) => (
            <button
              key={m}
              title={METRIC_CONFIG[m].description}
              style={{ ...styles.metricTab, ...(metric === m ? { ...styles.metricTabActive, color: METRIC_CONFIG[m].color, borderColor: METRIC_CONFIG[m].color } : {}) }}
              onClick={() => setMetric(m)}
            >
              {METRIC_CONFIG[m].label}
            </button>
          ))}
        </div>
      </div>

      {/* GC state legend */}
      <div style={styles.legend}>
        {(["clean", "soft_gc", "hard_gc"] as const).map((s) => (
          <span key={s} style={styles.legendItem}>
            <span style={{ ...styles.legendDot, background: GC_COLOR[s] }} />
            {s === "clean" ? "Clean <60%" : s === "soft_gc" ? "Soft GC 60–80%" : "Hard GC >80%"}
          </span>
        ))}
        <span style={{ ...styles.legendItem, marginLeft: "auto", color: cfg.color }}>
          {cfg.description}
        </span>
      </div>

      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 24, right: 48, bottom: 32, left: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#2c2c2e" />
          <XAxis
            dataKey="ctxPct"
            type="number"
            domain={[0, xMax]}
            tickFormatter={(v) => `${v}%`}
            stroke="#48484a"
            tick={{ fill: "#636366", fontSize: 11 }}
            label={{ value: "context utilisation", position: "insideBottom", offset: -12, fill: "#48484a", fontSize: 11 }}
          />
          <YAxis
            domain={[0, 1]}
            tickFormatter={(v) => v.toFixed(1)}
            stroke="#48484a"
            tick={{ fill: "#636366", fontSize: 11 }}
            label={{ value: cfg.yLabel, angle: -90, position: "insideLeft", offset: 12, fill: "#48484a", fontSize: 11 }}
          />
          <Tooltip content={<CustomTooltip metric={metric} />} />

          {/* Zone threshold markers */}
          <ReferenceLine x={60} stroke={GC_COLOR.soft_gc} strokeDasharray="4 3" strokeOpacity={0.6}
            label={{ value: "Soft GC", position: "top", fill: GC_COLOR.soft_gc, fontSize: 10 }} />
          <ReferenceLine x={80} stroke={GC_COLOR.hard_gc} strokeDasharray="4 3" strokeOpacity={0.6}
            label={{ value: "Hard GC", position: "top", fill: GC_COLOR.hard_gc, fontSize: 10 }} />

          {/* GC event annotations — actual session crossings */}
          {(() => {
            const seen = new Set<string>();
            return gcEvents.map((ev) => {
              const x = Math.round(ev.ctx_pct_at_trigger * 1000) / 10;
              const color = GC_COLOR[ev.gc_type] ?? GC_COLOR.soft_gc;
              const isFirst = !seen.has(ev.gc_type);
              if (isFirst) seen.add(ev.gc_type);
              return (
                <ReferenceLine key={ev.id} x={x} stroke={color} strokeWidth={1} strokeOpacity={0.35}
                  label={isFirst ? { value: "↓", position: "top", fill: color, fontSize: 10 } : undefined} />
              );
            });
          })()}

          <Line
            type="monotone"
            dataKey={metric}
            dot={<CustomDot metric={metric} />}
            activeDot={{ r: 5 }}
            stroke={cfg.color}
            strokeWidth={1.5}
            isAnimationActive={false}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    flex: 1,
    minHeight: 0,
    display: "flex",
    flexDirection: "column",
    padding: "16px 24px",
    overflow: "hidden",
  },
  titleRow: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 10,
  },
  title: {
    fontSize: 13,
    fontWeight: 600,
    color: "#aeaeb2",
    fontFamily: "monospace",
  },
  metricTabs: {
    display: "flex",
    gap: 4,
  },
  metricTab: {
    padding: "3px 10px",
    fontSize: 11,
    fontFamily: "monospace",
    background: "transparent",
    border: "1px solid #2c2c2e",
    borderRadius: 4,
    color: "#48484a",
    cursor: "pointer",
  },
  metricTabActive: {
    background: "#1c1c1e",
  },
  legend: {
    display: "flex",
    alignItems: "center",
    gap: 20,
    marginBottom: 12,
    flexWrap: "wrap" as const,
  },
  legendItem: {
    display: "flex",
    alignItems: "center",
    gap: 6,
    fontSize: 11,
    color: "#636366",
  },
  legendDot: {
    width: 8,
    height: 8,
    borderRadius: "50%",
    flexShrink: 0,
  },
  empty: {
    flex: 1,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    color: "#48484a",
    fontSize: 13,
  },
};
