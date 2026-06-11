import React, { useMemo } from "react";
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
import { ChartPoint, computeQuality } from "../quality.js";

function CustomDot(props: any) {
  const { cx, cy, payload } = props;
  const color =
    GC_COLOR[payload.gcState as keyof typeof GC_COLOR] ?? GC_COLOR.clean;
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

function CustomTooltip({ active, payload }: any) {
  if (!active || !payload?.length) return null;
  const d = payload[0].payload as ChartPoint;
  const color = GC_COLOR[d.gcState as keyof typeof GC_COLOR] ?? GC_COLOR.clean;
  return (
    <div style={tooltipStyle}>
      <div style={{ color, fontWeight: 600, marginBottom: 4 }}>
        {d.ctxPct.toFixed(1)}% context
      </div>
      <div style={{ color: "#aeaeb2" }}>
        quality:{" "}
        <span style={{ color: "#f2f2f7" }}>{d.quality.toFixed(2)}</span>
      </div>
      <div style={{ color: "#aeaeb2" }}>
        turn: <span style={{ color: "#f2f2f7" }}>#{d.turnIndex}</span>
      </div>
    </div>
  );
}

const tooltipStyle: React.CSSProperties = {
  background: "#1c1c1e",
  border: "1px solid #3a3a3c",
  borderRadius: 6,
  padding: "8px 12px",
  fontSize: 12,
  fontFamily: "monospace",
};

type Props = {
  turns: Turn[];
  sessionName?: string;
  gcEvents?: GCEvent[];
};

export function EfficiencyCurve({ turns, sessionName, gcEvents = [] }: Props) {
  const data = useMemo(() => computeQuality(turns), [turns]);

  if (data.length === 0) {
    return <div style={styles.empty}>No turn data</div>;
  }

  const maxCtx = Math.max(...data.map((d) => d.ctxPct));
  const xMax = Math.max(100, Math.ceil(maxCtx / 20) * 20);

  return (
    <div style={styles.container}>
      <div style={styles.title}>
        {sessionName ?? "Session"} — Context Efficiency Curve
      </div>
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
          <CartesianGrid strokeDasharray="3 3" stroke="#2c2c2e" />
          <XAxis
            dataKey="ctxPct"
            type="number"
            domain={[0, xMax]}
            tickFormatter={(v) => `${v}%`}
            stroke="#48484a"
            tick={{ fill: "#636366", fontSize: 11 }}
            label={{
              value: "context utilisation",
              position: "insideBottom",
              offset: -12,
              fill: "#48484a",
              fontSize: 11,
            }}
          />
          <YAxis
            domain={[0, 1]}
            tickFormatter={(v) => v.toFixed(1)}
            stroke="#48484a"
            tick={{ fill: "#636366", fontSize: 11 }}
            label={{
              value: "quality proxy",
              angle: -90,
              position: "insideLeft",
              offset: 12,
              fill: "#48484a",
              fontSize: 11,
            }}
          />
          <Tooltip content={<CustomTooltip />} />
          <ReferenceLine
            x={60}
            stroke={GC_COLOR.soft_gc}
            strokeDasharray="4 3"
            strokeOpacity={0.6}
            label={{
              value: "Soft GC",
              position: "top",
              fill: GC_COLOR.soft_gc,
              fontSize: 10,
            }}
          />
          <ReferenceLine
            x={80}
            stroke={GC_COLOR.hard_gc}
            strokeDasharray="4 3"
            strokeOpacity={0.6}
            label={{
              value: "Hard GC",
              position: "top",
              fill: GC_COLOR.hard_gc,
              fontSize: 10,
            }}
          />
          {/* GC event annotations — actual session crossings, first of each type labelled */}
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
                  label={
                    isFirst
                      ? {
                          value: "↓",
                          position: "top",
                          fill: color,
                          fontSize: 10,
                        }
                      : undefined
                  }
                />
              );
            });
          })()}
          <Line
            type="monotone"
            dataKey="quality"
            dot={<CustomDot />}
            activeDot={{ r: 5 }}
            stroke="#636366"
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
    padding: "20px 24px",
    overflow: "hidden",
  },
  title: {
    fontSize: 13,
    fontWeight: 600,
    color: "#aeaeb2",
    marginBottom: 12,
    fontFamily: "monospace",
  },
  legend: {
    display: "flex",
    gap: 20,
    marginBottom: 16,
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
