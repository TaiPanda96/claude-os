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
import { Turn, GCEvent, GC_COLOR, GC_TEXT } from "../types.js";
import { ChartPoint, Metric, computeQuality } from "../quality.js";
import { tokens } from "../theme.js";

interface MetricMeta {
  label: string;
  signal: string;
  formula: string;
  watchFor: string;
  yLabel: string;
  color: string;
}

const METRIC_CONFIG: Record<Metric, MetricMeta> = {
  quality: {
    label: "Output Quality",
    signal: "Is Claude degrading as context fills?",
    formula:
      "0.5 × output density  +  0.3 × (1 − self-corrections)  +  0.2 × (1 − repetition)",
    watchFor:
      "Sustained drops past 60% ctx — earlier the drop, the more context is hurting output",
    yLabel: "quality score  [0–1]",
    color: tokens.text,
  },
  marginalDensity: {
    label: "Context Bloat Rate",
    signal: "How fast is context inflating vs. useful output?",
    formula: "new ctx tokens introduced this turn  ÷  output tokens produced",
    watchFor:
      "Rising ratio → context growing faster than work — approaching diminishing returns",
    yLabel: "ctx tokens per output token",
    color: "#bf5af2",
  },
  workEfficiency: {
    label: "Token Cost / Artifact",
    signal: "Are meaningful turns getting more expensive to produce?",
    formula:
      "cumulative tokens consumed  ÷  high-output turns produced (running total)",
    watchFor:
      "Steadily rising curve = GC pressure — each useful turn costs more tokens than the last",
    yLabel: "tokens per artifact",
    color: "#0a84ff",
  },
};

function CustomDot(props: any) {
  const {
    cx,
    cy,
    payload,
    metric,
  }: { cx: number; cy: number; payload: ChartPoint; metric: Metric } = props;
  const color =
    metric === "quality"
      ? (GC_COLOR[payload.gcState as keyof typeof GC_COLOR] ?? GC_COLOR.clean)
      : METRIC_CONFIG[metric].color;
  return (
    <circle
      cx={cx}
      cy={cy}
      r={3}
      fill={color}
      fillOpacity={0.8}
      stroke="none"
    />
  );
}

function CustomTooltip({ active, payload, metric }: any) {
  if (!active || !payload?.length) return null;
  const d = payload[0].payload as ChartPoint;
  const stateTextColor =
    GC_TEXT[d.gcState as keyof typeof GC_TEXT] ?? GC_TEXT.clean;
  return (
    <div style={tooltipStyle}>
      <div style={{ color: stateTextColor, fontWeight: 600, marginBottom: 6 }}>
        {d.ctxPct.toFixed(1)}% context · turn #{d.turnIndex}
      </div>
      <div style={tooltipRow}>
        <span style={tooltipLabel}>quality</span>
        <span style={tooltipValue}>{d.quality.toFixed(2)}</span>
      </div>
      <div style={tooltipRow}>
        <span
          style={{
            ...tooltipLabel,
            color: METRIC_CONFIG.marginalDensity.color,
          }}
        >
          context bloat rate
        </span>
        <span style={tooltipValue}>
          {d.marginalDensityRaw.toFixed(1)}x
          <span style={{ color: tokens.muted, marginLeft: 4 }}>
            ({d.marginalDensity.toFixed(2)})
          </span>
        </span>
      </div>
      <div style={tooltipRow}>
        <span
          style={{ ...tooltipLabel, color: METRIC_CONFIG.workEfficiency.color }}
        >
          token cost / artifact
        </span>
        <span style={tooltipValue}>
          {d.workEfficiencyRaw.toLocaleString()} tok
          <span style={{ color: tokens.muted, marginLeft: 4 }}>
            ({d.workEfficiency.toFixed(2)})
          </span>
        </span>
      </div>
    </div>
  );
}

const tooltipStyle: React.CSSProperties = {
  background: tokens.surface1,
  border: `1px solid ${tokens.border}`,
  borderRadius: tokens.radiusMd,
  padding: "10px 14px",
  fontSize: tokens.fsData,
  fontFamily: tokens.fontMono,
  minWidth: 240,
};
const tooltipRow: React.CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  gap: 16,
  marginTop: 3,
};
const tooltipLabel: React.CSSProperties = { color: tokens.muted };
const tooltipValue: React.CSSProperties = { color: tokens.highlight };

type Props = {
  turns: Turn[];
  sessionName?: string | undefined;
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
      {/* Title */}
      <div style={styles.title}>
        {sessionName ?? "Session"} — Context Efficiency Curve
      </div>

      {/* Metric selector — card tabs */}
      <div style={styles.metricTabs}>
        {(Object.keys(METRIC_CONFIG) as Metric[]).map((m) => {
          const active = metric === m;
          const mcfg = METRIC_CONFIG[m];
          return (
            <button
              key={m}
              style={{
                ...styles.metricTab,
                borderLeftColor: active ? mcfg.color : "transparent",
                background: active ? tokens.surface2 : tokens.surface1,
              }}
              onClick={() => setMetric(m)}
            >
              <span
                style={{
                  ...styles.metricTabLabel,
                  color: active ? tokens.highlight : tokens.muted,
                }}
              >
                {mcfg.label}
              </span>
              <span
                style={{
                  ...styles.metricTabSignal,
                  color: active ? mcfg.color : tokens.border,
                }}
              >
                {mcfg.signal}
              </span>
            </button>
          );
        })}
      </div>

      {/* Signal bar — formula + what to watch for */}
      <div style={styles.signalBar}>
        <span style={styles.signalFormula}>
          <span style={{ color: cfg.color, marginRight: 6 }}>ƒ</span>
          {cfg.formula}
        </span>
        <span style={styles.signalWatch}>
          <span style={{ color: tokens.muted, marginRight: 4 }}>Watch:</span>
          {cfg.watchFor}
        </span>
      </div>

      {/* GC state legend */}
      <div style={styles.legend}>
        {(["clean", "soft_gc", "hard_gc"] as const).map((s) => (
          <span key={s} style={styles.legendItem}>
            <span style={{ ...styles.legendDot, background: GC_COLOR[s] }} />
            {s === "clean"
              ? "Clean <60%"
              : s === "soft_gc"
                ? "Soft GC 60–80%"
                : "Hard GC >80%"}
          </span>
        ))}
      </div>

      <ResponsiveContainer width="100%" height="100%">
        <LineChart
          data={data}
          margin={{ top: 24, right: 48, bottom: 32, left: 0 }}
        >
          <CartesianGrid strokeDasharray="3 3" stroke={tokens.surface2} />
          <XAxis
            dataKey="ctxPct"
            type="number"
            domain={[0, xMax]}
            tickFormatter={(v) => `${v}%`}
            stroke={tokens.border}
            tick={{ fill: tokens.muted, fontSize: tokens.fsLabel }}
            label={{
              value: "context utilisation",
              position: "insideBottom",
              offset: -12,
              fill: tokens.border,
              fontSize: tokens.fsLabel,
            }}
          />
          <YAxis
            domain={[0, 1]}
            tickFormatter={(v) => v.toFixed(1)}
            stroke={tokens.border}
            tick={{ fill: tokens.muted, fontSize: tokens.fsLabel }}
            label={{
              value: cfg.yLabel,
              angle: -90,
              position: "insideLeft",
              offset: 12,
              fill: tokens.border,
              fontSize: tokens.fsLabel,
            }}
          />
          <Tooltip content={<CustomTooltip metric={metric} />} />

          {/* Zone threshold markers */}
          <ReferenceLine
            x={60}
            stroke={GC_TEXT.soft_gc}
            strokeDasharray="4 3"
            strokeOpacity={0.6}
            label={{
              value: "Soft GC",
              position: "top",
              fill: GC_TEXT.soft_gc,
              fontSize: 10,
            }}
          />
          <ReferenceLine
            x={80}
            stroke={GC_TEXT.hard_gc}
            strokeDasharray="4 3"
            strokeOpacity={0.6}
            label={{
              value: "Hard GC",
              position: "top",
              fill: GC_TEXT.hard_gc,
              fontSize: 10,
            }}
          />

          {/* GC event annotations — actual session crossings */}
          {(() => {
            const seen = new Set<string>();
            return gcEvents.map((ev) => {
              const x = Math.round(ev.ctx_pct_at_trigger * 1000) / 10;
              const color = GC_COLOR[ev.gc_type] ?? GC_COLOR.soft_gc;
              const isFirst = !seen.has(ev.gc_type);
              if (isFirst) seen.add(ev.gc_type);
              return (
                <ReferenceLine
                  key={ev.id}
                  x={x}
                  stroke={color}
                  strokeWidth={1}
                  strokeOpacity={0.35}
                  {...(isFirst
                    ? {
                        label: {
                          value: "↓",
                          position: "top" as const,
                          fill: color,
                          fontSize: 10,
                        },
                      }
                    : {})}
                />
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
    padding: `${tokens.sp3}px ${tokens.sp6}px ${tokens.sp4}px`,
    overflow: "hidden",
    background: tokens.surface0,
  },
  title: {
    fontSize: tokens.fsBody,
    fontWeight: 600,
    color: tokens.muted,
    fontFamily: tokens.fontMono,
    marginBottom: tokens.sp2,
  },
  metricTabs: {
    display: "grid",
    gridTemplateColumns: "1fr 1fr 1fr",
    gap: tokens.sp2,
    marginBottom: tokens.sp2,
  },
  metricTab: {
    display: "flex",
    flexDirection: "column",
    alignItems: "flex-start",
    gap: 3,
    padding: `${tokens.sp2}px ${tokens.sp3}px`,
    borderRadius: tokens.radiusSm,
    borderLeft: `3px solid transparent`,
    border: `1px solid ${tokens.surface2}`,
    borderLeftWidth: 3,
    cursor: "pointer",
    textAlign: "left" as const,
    transition: "background 0.15s, border-color 0.15s",
    fontFamily: tokens.fontMono,
  },
  metricTabLabel: {
    fontSize: tokens.fsBody,
    fontWeight: 600,
    letterSpacing: "-0.01em",
  },
  metricTabSignal: {
    fontSize: tokens.fsMicro,
    lineHeight: 1.4,
    fontStyle: "italic",
  },
  signalBar: {
    display: "flex",
    flexDirection: "column",
    gap: 2,
    padding: `${tokens.sp2}px ${tokens.sp3}px`,
    background: tokens.surface1,
    borderRadius: tokens.radiusSm,
    marginBottom: tokens.sp2,
    borderLeft: `1px solid ${tokens.border}`,
  },
  signalFormula: {
    fontSize: tokens.fsMicro,
    color: tokens.text,
    fontFamily: tokens.fontMono,
    letterSpacing: "0.01em",
  },
  signalWatch: {
    fontSize: tokens.fsMicro,
    color: tokens.muted,
    fontFamily: tokens.fontMono,
  },
  legend: {
    display: "flex",
    alignItems: "center",
    gap: 20,
    marginBottom: tokens.sp2,
  },
  legendItem: {
    display: "flex",
    alignItems: "center",
    gap: 6,
    fontSize: tokens.fsMicro,
    color: tokens.muted,
    fontFamily: tokens.fontMono,
  },
  legendDot: {
    width: 7,
    height: 7,
    borderRadius: "50%",
    flexShrink: 0,
  },
  empty: {
    flex: 1,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    color: tokens.muted,
    fontSize: tokens.fsBody,
    fontFamily: tokens.fontMono,
  },
};
