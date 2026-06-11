import React, { useState, useRef, useCallback } from "react";
import { SessionRow, GCEvent, GC_COLOR, gcState } from "../types.js";
import { SessionDetail } from "../types.js";
import { EfficiencyCurve } from "./EfficiencyCurve.js";
import { SessionSummary } from "./SessionSummary.js";

interface Props {
  session: SessionRow;
  detail: SessionDetail;
  gcEvents: GCEvent[];
  onClose: () => void;
}

const MIN_HEIGHT = 280;
const MAX_HEIGHT = 720;
const DEFAULT_HEIGHT = 420;

export function DetailPanel({ session, detail, gcEvents, onClose }: Props) {
  const [height, setHeight] = useState(DEFAULT_HEIGHT);
  const dragStart = useRef<{ y: number; h: number } | null>(null);

  const onDragStart = useCallback((e: React.MouseEvent) => {
    dragStart.current = { y: e.clientY, h: height };
    const onMove = (mv: MouseEvent) => {
      if (!dragStart.current) return;
      const delta = dragStart.current.y - mv.clientY;
      setHeight(Math.min(MAX_HEIGHT, Math.max(MIN_HEIGHT, dragStart.current.h + delta)));
    };
    const onUp = () => {
      dragStart.current = null;
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }, [height]);

  const pct = session.current_ctx_pct ?? 0;
  const state = gcState(pct);
  const color = GC_COLOR[state];

  return (
    <div style={{ ...styles.panel, height }}>
      {/* Drag handle */}
      <div style={styles.handle} onMouseDown={onDragStart}>
        <div style={styles.handleGrip} />
      </div>

      {/* Compact session header */}
      <div style={styles.header}>
        <span style={{ ...styles.dot, background: color }} />
        <span style={styles.sessionName}>{session.name ?? "unnamed"}</span>
        <span style={styles.sessionId}>{session.id.slice(0, 8)}</span>
        <span style={{ ...styles.ctxBadge, color }}>{(pct * 100).toFixed(1)}% ctx</span>
        <span style={styles.turns}>{session.turn_count} turns</span>
        <span style={styles.model}>{session.model.replace("claude-", "")}</span>
        <button style={styles.close} onClick={onClose}>✕</button>
      </div>

      {/* Summary + curve */}
      <div style={styles.body}>
        <SessionSummary turns={detail.turns} gcEvents={gcEvents} />
        <EfficiencyCurve
          turns={detail.turns}
          sessionName={session.name ?? undefined}
          gcEvents={gcEvents}
        />
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  panel: {
    borderTop: "1px solid #2c2c2e",
    background: "#0d0d0f",
    display: "flex",
    flexDirection: "column",
    flexShrink: 0,
    overflow: "hidden",
  },
  handle: {
    height: 8,
    cursor: "ns-resize",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    background: "#111113",
    borderBottom: "1px solid #1c1c1e",
    flexShrink: 0,
  },
  handleGrip: {
    width: 32,
    height: 2,
    borderRadius: 1,
    background: "#3a3a3c",
  },
  header: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    padding: "6px 20px",
    borderBottom: "1px solid #2c2c2e",
    background: "#111113",
    flexShrink: 0,
  },
  dot: {
    width: 7,
    height: 7,
    borderRadius: "50%",
    flexShrink: 0,
  },
  sessionName: {
    fontSize: 13,
    fontWeight: 600,
    fontFamily: "monospace",
    color: "#f2f2f7",
  },
  sessionId: {
    fontSize: 10,
    fontFamily: "monospace",
    color: "#3a3a3c",
  },
  ctxBadge: {
    fontSize: 12,
    fontWeight: 600,
    fontFamily: "monospace",
    fontVariantNumeric: "tabular-nums",
  },
  turns: {
    fontSize: 11,
    fontFamily: "monospace",
    color: "#48484a",
  },
  model: {
    fontSize: 11,
    fontFamily: "monospace",
    color: "#48484a",
    marginLeft: "auto",
  },
  close: {
    background: "transparent",
    border: "none",
    color: "#48484a",
    fontSize: 12,
    cursor: "pointer",
    padding: "2px 6px",
    borderRadius: 4,
    fontFamily: "monospace",
  },
  body: {
    flex: 1,
    display: "flex",
    flexDirection: "column",
    overflow: "hidden",
    minHeight: 0,
  },
};
