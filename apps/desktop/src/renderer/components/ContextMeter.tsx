import React from "react";
import { GC_COLOR, GCState, gcState } from "../types.js";

interface Props {
  ctxPct: number;
  turnCount: number;
  model: string;
}

export function ContextMeter({ ctxPct, turnCount, model }: Props) {
  const state: GCState = gcState(ctxPct);
  const color = GC_COLOR[state];
  const pctDisplay = (ctxPct * 100).toFixed(1);

  const stateLabel: Record<GCState, string> = {
    clean: "Clean",
    soft_gc: "Soft GC",
    hard_gc: "Hard GC",
  };

  return (
    <div style={styles.container}>
      <div style={styles.row}>
        <div>
          <div style={{ ...styles.bigPct, color }}>{pctDisplay}%</div>
          <div style={styles.label}>context used</div>
        </div>
        <div style={styles.divider} />
        <div>
          <div style={styles.stat}>{turnCount}</div>
          <div style={styles.label}>turns</div>
        </div>
        <div style={styles.divider} />
        <div>
          <div style={{ ...styles.stat, color }}>{stateLabel[state]}</div>
          <div style={styles.label}>gc state</div>
        </div>
        <div style={styles.divider} />
        <div>
          <div style={styles.stat}>{model.replace("claude-", "")}</div>
          <div style={styles.label}>model</div>
        </div>
      </div>
      <div style={styles.track}>
        <div style={{ ...styles.softZone }} />
        <div style={{ ...styles.hardZone }} />
        <div
          style={{
            ...styles.fill,
            width: `${Math.min(ctxPct * 100, 100)}%`,
            background: color,
          }}
        />
        <div style={styles.softLine} title="Soft GC (60%)" />
        <div style={styles.hardLine} title="Hard GC (80%)" />
      </div>
      <div style={styles.trackLabels}>
        <span>0%</span>
        <span
          style={{
            position: "absolute",
            left: "60%",
            transform: "translateX(-50%)",
            color: GC_COLOR.soft_gc,
          }}
        >
          60%
        </span>
        <span
          style={{
            position: "absolute",
            left: "80%",
            transform: "translateX(-50%)",
            color: GC_COLOR.hard_gc,
          }}
        >
          80%
        </span>
        <span style={{ marginLeft: "auto" }}>100%</span>
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    padding: "16px 24px",
    borderBottom: "1px solid #2c2c2e",
    background: "#111113",
  },
  row: {
    display: "flex",
    alignItems: "center",
    gap: 24,
    marginBottom: 14,
  },
  bigPct: {
    fontSize: 28,
    fontWeight: 700,
    fontVariantNumeric: "tabular-nums",
    fontFamily: "monospace",
    lineHeight: 1,
    marginBottom: 3,
  },
  stat: {
    fontSize: 16,
    fontWeight: 600,
    color: "#f2f2f7",
    fontFamily: "monospace",
    lineHeight: 1,
    marginBottom: 3,
  },
  label: {
    fontSize: 10,
    color: "#48484a",
    textTransform: "uppercase",
    letterSpacing: "0.06em",
  },
  divider: {
    width: 1,
    height: 36,
    background: "#2c2c2e",
  },
  track: {
    position: "relative",
    height: 6,
    background: "#2c2c2e",
    borderRadius: 3,
    overflow: "visible",
    marginBottom: 4,
  },
  softZone: {
    position: "absolute",
    left: "60%",
    width: "20%",
    height: "100%",
    background: `${GC_COLOR.soft_gc}18`,
    borderRadius: 0,
  },
  hardZone: {
    position: "absolute",
    left: "80%",
    width: "20%",
    height: "100%",
    background: `${GC_COLOR.hard_gc}18`,
    borderRadius: "0 3px 3px 0",
  },
  fill: {
    position: "absolute",
    top: 0,
    left: 0,
    height: "100%",
    borderRadius: 3,
    transition: "width 0.4s ease, background 0.3s ease",
    zIndex: 1,
  },
  softLine: {
    position: "absolute",
    left: "60%",
    top: -3,
    width: 1,
    height: 12,
    background: GC_COLOR.soft_gc,
    opacity: 0.5,
  },
  hardLine: {
    position: "absolute",
    left: "80%",
    top: -3,
    width: 1,
    height: 12,
    background: GC_COLOR.hard_gc,
    opacity: 0.5,
  },
  trackLabels: {
    position: "relative",
    display: "flex",
    fontSize: 10,
    color: "#48484a",
  },
};
