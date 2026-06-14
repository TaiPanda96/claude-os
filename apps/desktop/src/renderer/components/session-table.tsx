import React, { useState } from "react";
import { SessionRow, GC_COLOR, GC_TEXT, GCState, gcState } from "../types.js";
import { tokens } from "../theme.js";

type SortKey = "name" | "model" | "current_ctx_pct" | "turn_count" | "gc_state";
type SortDir = "asc" | "desc";

interface Props {
  sessions: SessionRow[];
  selected: string | null;
  onSelect: (id: string) => void;
}

const GC_LABEL: Record<GCState, string> = {
  clean: "Clean",
  soft_gc: "Soft GC",
  hard_gc: "Hard GC",
};

export function SessionTable({ sessions, selected, onSelect }: Props) {
  const [sortKey, setSortKey] = useState<SortKey>("current_ctx_pct");
  const [sortDir, setSortDir] = useState<SortDir>("desc");

  function handleSort(key: SortKey) {
    if (key === sortKey) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir("desc");
    }
  }

  const sorted = [...sessions].sort((a, b) => {
    let av: string | number, bv: string | number;
    switch (sortKey) {
      case "name":
        av = a.name ?? "";
        bv = b.name ?? "";
        break;
      case "model":
        av = a.model;
        bv = b.model;
        break;
      case "turn_count":
        av = a.turn_count;
        bv = b.turn_count;
        break;
      case "gc_state":
        av = a.current_ctx_pct ?? 0;
        bv = b.current_ctx_pct ?? 0;
        break;
      case "current_ctx_pct":
      default:
        av = a.current_ctx_pct ?? 0;
        bv = b.current_ctx_pct ?? 0;
    }
    const cmp = av < bv ? -1 : av > bv ? 1 : 0;
    return sortDir === "asc" ? cmp : -cmp;
  });

  function col(label: string, key: SortKey, align: "left" | "right" = "left") {
    const active = sortKey === key;
    return (
      <th
        style={{
          ...styles.th,
          textAlign: align,
          cursor: "pointer",
          color: active ? tokens.text : tokens.border,
        }}
        onClick={() => handleSort(key)}
      >
        {label} {active ? (sortDir === "asc" ? "↑" : "↓") : ""}
      </th>
    );
  }

  return (
    <div style={styles.container}>
      <table style={styles.table}>
        <thead>
          <tr style={styles.headerRow}>
            {col("Session", "name")}
            {col("Model", "model")}
            <th style={{ ...styles.th, width: 200 }}>Context Depth</th>
            {col("CTX %", "current_ctx_pct", "right")}
            {col("Turns", "turn_count", "right")}
            {col("GC State", "gc_state", "right")}
          </tr>
        </thead>
        <tbody>
          {sorted.map((s) => {
            const pct = s.current_ctx_pct ?? 0;
            const state = gcState(pct);
            const dotColor = GC_COLOR[state];
            const textColor = GC_TEXT[state];
            const isSelected = s.id === selected;
            const isHardGC = state === "hard_gc";
            const approxTokens = Math.round(pct * (s.ctx_window ?? 200_000));

            const rowClass = isHardGC ? "gc-row--hard_gc" : undefined;

            return (
              <tr
                key={s.id}
                className={rowClass}
                style={{
                  ...styles.row,
                  ...(isSelected && !isHardGC ? styles.rowSelected : {}),
                }}
                onClick={() => onSelect(s.id)}
              >
                {/* Session name */}
                <td style={styles.td}>
                  <div style={styles.sessionCell}>
                    <span className={`gc-dot gc-dot--${state}`} />
                    <span
                      style={{
                        ...styles.sessionName,
                        color: isHardGC ? GC_TEXT.hard_gc : tokens.highlight,
                      }}
                    >
                      {s.name ?? "unnamed"}
                    </span>
                    <span style={styles.sessionId}>{s.id.slice(0, 6)}</span>
                  </div>
                </td>

                {/* Model */}
                <td style={styles.td}>
                  <span style={styles.mono}>
                    {s.model.replace("claude-", "")}
                  </span>
                </td>

                {/* Progress bar */}
                <td style={styles.td}>
                  <div style={styles.barTrack}>
                    <div
                      style={{
                        ...styles.barFill,
                        width: `${Math.min(pct * 100, 100)}%`,
                        background: dotColor,
                      }}
                    />
                    <div
                      style={{
                        ...styles.barZone,
                        left: "60%",
                        background: `${GC_COLOR.soft_gc}22`,
                      }}
                    />
                    <div
                      style={{
                        ...styles.barZone,
                        left: "80%",
                        width: "20%",
                        background: `${GC_COLOR.hard_gc}22`,
                      }}
                    />
                  </div>
                  <span style={styles.barTokens}>
                    {approxTokens > 0
                      ? `${(approxTokens / 1000).toFixed(1)}k`
                      : "—"}
                  </span>
                </td>

                {/* CTX % */}
                <td style={{ ...styles.td, textAlign: "right" }}>
                  <span
                    style={{
                      ...styles.mono,
                      color: textColor,
                      fontWeight: 600,
                    }}
                  >
                    {Math.min(pct * 100, 100).toFixed(1)}%
                  </span>
                </td>

                {/* Turns */}
                <td style={{ ...styles.td, textAlign: "right" }}>
                  <span style={styles.mono}>{s.turn_count}</span>
                </td>

                {/* GC State chip */}
                <td style={{ ...styles.td, textAlign: "right" }}>
                  <span className={`gc-chip gc-chip--${state}`}>
                    <span className={`gc-dot gc-dot--${state}`} />
                    {GC_LABEL[state]}
                  </span>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>

      {sessions.length === 0 && (
        <div style={styles.empty}>No sessions — run bun run ingest</div>
      )}
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    flex: 1,
    overflowY: "auto",
    background: tokens.void,
  },
  table: {
    width: "100%",
    borderCollapse: "collapse",
    tableLayout: "fixed",
  },
  headerRow: {
    borderBottom: `0.5px solid ${tokens.border}`,
    position: "sticky",
    top: 0,
    background: tokens.headerRow,
    zIndex: 1,
  },
  th: {
    padding: "10px 16px",
    fontSize: tokens.fsMicro,
    fontWeight: 500,
    letterSpacing: "0.06em",
    textTransform: "uppercase" as const,
    color: tokens.border,
    fontFamily: tokens.fontMono,
    userSelect: "none" as const,
  },
  row: {
    borderBottom: `0.5px solid ${tokens.surface1}`,
    cursor: "pointer",
    transition: "background 0.2s",
  },
  rowSelected: {
    background: tokens.surface2,
  },
  td: {
    padding: "8px 16px",
    verticalAlign: "middle",
  },
  sessionCell: {
    display: "flex",
    alignItems: "center",
    gap: tokens.sp2,
  },
  sessionName: {
    fontSize: tokens.fsBody,
    fontWeight: 500,
    fontFamily: tokens.fontMono,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap" as const,
  },
  sessionId: {
    color: tokens.border,
    fontSize: tokens.fsMicro,
    fontFamily: tokens.fontMono,
    flexShrink: 0,
  },
  mono: {
    color: tokens.text,
    fontSize: tokens.fsData,
    fontFamily: tokens.fontMono,
    fontVariantNumeric: "tabular-nums",
  },
  barTrack: {
    position: "relative",
    height: 3,
    background: tokens.surface2,
    borderRadius: 999,
    overflow: "hidden",
    marginBottom: 3,
  },
  barFill: {
    position: "absolute",
    top: 0,
    left: 0,
    height: "100%",
    borderRadius: 999,
    transition: "width 0.4s ease",
    zIndex: 1,
  },
  barZone: {
    position: "absolute",
    top: 0,
    width: "20%",
    height: "100%",
  },
  barTokens: {
    color: tokens.muted,
    fontSize: tokens.fsMicro,
    fontFamily: tokens.fontMono,
  },
  empty: {
    padding: 32,
    textAlign: "center" as const,
    color: tokens.muted,
    fontSize: tokens.fsBody,
    fontFamily: tokens.fontMono,
  },
};
