import React, { useState, useRef, useCallback } from "react";
import { SessionRow, GCEvent, GC_TEXT, gcState } from "../types.js";
import { SessionDetail, CompactionEventDetail } from "../types.js";
import { EfficiencyCurve } from "./efficiency-curve.js";
import { tokens } from "../theme.js";
import { SessionSummary } from "./session/session-summary.js";
import { CompactionHistory } from "./session/compaction-history.js";

interface Props {
  session: SessionRow;
  detail: SessionDetail;
  gcEvents: GCEvent[];
  compactionEvents: CompactionEventDetail[];
  onClose: () => void;
}

const MIN_HEIGHT = 280;
const MAX_HEIGHT = 720;
const DEFAULT_HEIGHT = 420;

export function DetailPanel({ session, detail, gcEvents, compactionEvents, onClose }: Props) {
  const [height, setHeight] = useState(DEFAULT_HEIGHT);
  const [copied, setCopied] = useState(false);
  const dragStart = useRef<{ y: number; h: number } | null>(null);
  const copyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const onCopyId = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(session.id);
      setCopied(true);
      if (copyTimer.current) clearTimeout(copyTimer.current);
      copyTimer.current = setTimeout(() => setCopied(false), 1200);
    } catch {
      // Clipboard can reject (e.g. unfocused document) — leave the id visible to copy manually.
    }
  }, [session.id]);

  const onDragStart = useCallback(
    (e: React.MouseEvent) => {
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
        <button
          style={styles.sessionId}
          onClick={onCopyId}
          title={copied ? "Copied!" : `Copy session id: ${session.id}`}
        >
          {copied ? "✓ copied" : `${session.id.slice(0, 8)} ⎘`}
        </button>
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
        <CompactionHistory events={compactionEvents} />
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
    color: tokens.muted,
    background: "transparent",
    border: "none",
    cursor: "pointer",
    padding: "2px 4px",
    borderRadius: tokens.radiusXs,
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
