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
import { efficiencyCurveStyles } from "./efficiency-curve-styles-config.js";
import { tokens } from "../theme.js";
import { METRIC_CONFIG } from "../metric-config.js";

const tooltipLabel: React.CSSProperties = { color: tokens.muted };
const tooltipValue: React.CSSProperties = { color: tokens.highlight };
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

type Props = {
  turns: Turn[];
  sessionName?: string | undefined;
  gcEvents?: GCEvent[];
};

export function EfficiencyCurve({ turns, sessionName, gcEvents = [] }: Props) {
  const [metric, setMetric] = useState<Metric>("quality");
  const data = useMemo(() => computeQuality(turns), [turns]);

  if (data.length === 0) {
    return <div style={efficiencyCurveStyles.empty}>No turn data</div>;
  }

  // Auto-fit the X domain to the session's actual context range so the size of the
  // context window (e.g. 1M on Max vs 200K) doesn't compress the curve into a sliver
  // on the left. Add ~8% headroom, round up to a readable step, cap at 100% (ctxPct
  // can't exceed its window). GC-zone/threshold markers therefore only appear when a
  // session actually reaches them — which is the truthful, un-skewed view.
  const maxCtx = Math.max(...data.map((d) => d.ctxPct));
  const padded = maxCtx * 1.08;
  const step = padded <= 20 ? 5 : padded <= 50 ? 10 : 20;
  const xMax = Math.min(100, Math.max(step, Math.ceil(padded / step) * step));
  const cfg = METRIC_CONFIG[metric];

  return (
    <div style={efficiencyCurveStyles.container}>
      {/* Title */}
      <div style={efficiencyCurveStyles.title}>
        {sessionName ?? "Session"} — Context Efficiency Curve
      </div>

      {/* Metric selector — card tabs */}
      <div style={efficiencyCurveStyles.metricTabs}>
        {(Object.keys(METRIC_CONFIG) as Metric[]).map((m) => {
          const active = metric === m;
          const mcfg = METRIC_CONFIG[m];
          return (
            <button
              key={m}
              style={{
                ...efficiencyCurveStyles.metricTab,
                borderLeftColor: active ? mcfg.color : "transparent",
                background: active ? tokens.surface2 : tokens.surface1,
              }}
              onClick={() => setMetric(m)}
            >
              <span
                style={{
                  ...efficiencyCurveStyles.metricTabLabel,
                  color: active ? tokens.highlight : tokens.muted,
                }}
              >
                {mcfg.label}
              </span>
              <span
                style={{
                  ...efficiencyCurveStyles.metricTabSignal,
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
      <div style={efficiencyCurveStyles.signalBar}>
        <span style={efficiencyCurveStyles.signalFormula}>
          <span style={{ color: cfg.color, marginRight: 6 }}>ƒ</span>
          {cfg.formula}
        </span>
        <span style={efficiencyCurveStyles.signalWatch}>
          <span style={{ color: tokens.muted, marginRight: 4 }}>Watch:</span>
          {cfg.watchFor}
        </span>
      </div>

      {/* GC state legend */}
      <div style={efficiencyCurveStyles.legend}>
        {(["clean", "soft_gc", "hard_gc"] as const).map((s) => (
          <span key={s} style={efficiencyCurveStyles.legendItem}>
            <span style={{ ...efficiencyCurveStyles.legendDot, background: GC_COLOR[s] }} />
            {s === "clean" ? "Clean <60%" : s === "soft_gc" ? "Soft GC 60–80%" : "Hard GC >80%"}
          </span>
        ))}
      </div>

      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 24, right: 48, bottom: 32, left: 0 }}>
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
              const color = GC_COLOR[ev.gc_type as keyof typeof GC_COLOR] ?? GC_COLOR.soft_gc;
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
            dot={<EfficiencyCurveDot metric={metric} />}
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

interface EfficiencyCurveDotProps {
  cx?: number;
  cy?: number;
  payload?: ChartPoint;
  metric: Metric;
}

function EfficiencyCurveDot(props: EfficiencyCurveDotProps) {
  const { cx, cy, payload, metric }: EfficiencyCurveDotProps = props;
  if (cx === undefined || cy === undefined || payload === undefined) return null;
  const color =
    metric === "quality"
      ? (GC_COLOR[payload.gcState as keyof typeof GC_COLOR] ?? GC_COLOR.clean)
      : METRIC_CONFIG[metric].color;
  return <circle cx={cx} cy={cy} r={3} fill={color} fillOpacity={0.8} stroke="none" />;
}

interface CustomTooltipProps {
  active?: boolean;
  payload?: any[];
  metric: Metric;
}

function CustomTooltip({ active, payload, metric }: CustomTooltipProps) {
  if (!active || !payload?.length) return null;
  const d = payload[0].payload as ChartPoint;
  const stateTextColor = GC_TEXT[d.gcState as keyof typeof GC_TEXT] ?? GC_TEXT.clean;
  return (
    <div style={tooltipStyle}>
      <div style={{ color: stateTextColor, fontWeight: 600, marginBottom: 6 }}>
        {d.ctxPct.toFixed(1)}% context · turn #{d.turnIndex}
      </div>
      <div style={tooltipRow}>
        <span style={{ ...tooltipLabel, color: METRIC_CONFIG.quality.color }}>quality</span>
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
        <span style={{ ...tooltipLabel, color: METRIC_CONFIG.workEfficiency.color }}>
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
