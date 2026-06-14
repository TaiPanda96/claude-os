import React, { useState, useRef, useCallback } from "react";
import { SessionRow, GCEvent, GC_TEXT, gcState } from "../types.js";
import { SessionDetail } from "../types.js";
import { EfficiencyCurve } from "./efficiency-curve.js";
import { SessionSummary } from "./session-summary.js";
import { tokens } from "../theme.js";

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

  const onDragStart = useCallback(
    (e: React.MouseEvent) => {
      dragStart.current = { y: e.clientY, h: height };
      const onMove = (mv: MouseEvent) => {
        if (!dragStart.current) return;
        const delta = dragStart.current.y - mv.clientY;
        setHeight(
          Math.min(
            MAX_HEIGHT,
            Math.max(MIN_HEIGHT, dragStart.current.h + delta),
          ),
        );
      };
      const onUp = () => {
        dragStart.current = null;
        window.removeEventListener("mousemove", onMove);
        window.removeEventListener("mouseup", onUp);
      };
      window.addEventListener("mousemove", onMove);
      window.addEventListener("mouseup", onUp);
    },
    [height],
  );

  const pct = session.current_ctx_pct ?? 0;
  const state = gcState(pct);
  const textColor = GC_TEXT[state];

  return (
    <div style={{ ...styles.panel, height }}>
      {/* Drag handle */}
      <div style={styles.handle} onMouseDown={onDragStart}>
        <div style={styles.handleGrip} />
      </div>

      {/* Compact session header */}
      <div style={styles.header}>
        <span className={`gc-dot gc-dot--${state}`} />
        <span style={styles.sessionName}>{session.name ?? "unnamed"}</span>
        <span style={styles.sessionId}>{session.id.slice(0, 8)}</span>
        <span style={{ ...styles.ctxBadge, color: textColor }}>
          {(Math.min(1, pct) * 100).toFixed(1)}% ctx
        </span>
        <span style={styles.meta}>{session.turn_count} turns</span>
        <span style={{ ...styles.meta, marginLeft: "auto" }}>
          {session.model.replace("claude-", "")}
        </span>
        <button style={styles.close} onClick={onClose}>
          ✕
        </button>
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
    borderTop: `0.5px solid ${tokens.border}`,
    background: tokens.void,
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
    background: tokens.surface0,
    borderBottom: `0.5px solid ${tokens.surface1}`,
    flexShrink: 0,
  },
  handleGrip: {
    width: 32,
    height: 2,
    borderRadius: 1,
    background: tokens.border,
  },
  header: {
    display: "flex",
    alignItems: "center",
    gap: tokens.sp2,
    padding: `6px ${tokens.sp6}px`,
    borderBottom: `0.5px solid ${tokens.border}`,
    background: tokens.surface0,
    flexShrink: 0,
  },
  sessionName: {
    fontSize: tokens.fsBody,
    fontWeight: 600,
    fontFamily: tokens.fontMono,
    color: tokens.highlight,
  },
  sessionId: {
    fontSize: tokens.fsMicro,
    fontFamily: tokens.fontMono,
    color: tokens.border,
  },
  ctxBadge: {
    fontSize: tokens.fsData,
    fontWeight: 600,
    fontFamily: tokens.fontMono,
    fontVariantNumeric: "tabular-nums",
  },
  meta: {
    fontSize: tokens.fsLabel,
    fontFamily: tokens.fontMono,
    color: tokens.muted,
  },
  close: {
    background: "transparent",
    border: "none",
    color: tokens.muted,
    fontSize: tokens.fsData,
    cursor: "pointer",
    padding: "2px 6px",
    borderRadius: tokens.radiusSm,
    fontFamily: tokens.fontMono,
  },
  body: {
    flex: 1,
    display: "flex",
    flexDirection: "column",
    overflow: "hidden",
    minHeight: 0,
  },
};
