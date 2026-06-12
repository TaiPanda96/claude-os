import React, { useState } from "react";
import { SessionRow, GC_COLOR, GCState, gcState } from "../types.js";

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
          color: active ? "#aeaeb2" : "#48484a",
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
            const color = GC_COLOR[state];
            const isSelected = s.id === selected;
            const approxTokens = Math.round(pct * (s.ctx_window ?? 200_000));

            return (
              <tr
                key={s.id}
                style={{
                  ...styles.row,
                  ...(isSelected ? styles.rowSelected : {}),
                }}
                onClick={() => onSelect(s.id)}
              >
                {/* Session name */}
                <td style={styles.td}>
                  <div style={styles.sessionCell}>
                    <span style={{ ...styles.dot, background: color }} />
                    <span style={styles.sessionName}>
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
                        background: color,
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
                  <span style={{ ...styles.mono, color, fontWeight: 600 }}>
                    {(pct * 100).toFixed(1)}%
                  </span>
                </td>

                {/* Turns */}
                <td style={{ ...styles.td, textAlign: "right" }}>
                  <span style={styles.mono}>{s.turn_count}</span>
                </td>

                {/* GC State */}
                <td style={{ ...styles.td, textAlign: "right" }}>
                  <span
                    style={{
                      ...styles.badge,
                      background: `${color}18`,
                      color,
                      borderColor: `${color}40`,
                    }}
                  >
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
    background: "#0d0d0f",
  },
  table: {
    width: "100%",
    borderCollapse: "collapse",
    tableLayout: "fixed",
  },
  headerRow: {
    borderBottom: "1px solid #2c2c2e",
    position: "sticky",
    top: 0,
    background: "#111113",
    zIndex: 1,
  },
  th: {
    padding: "10px 16px",
    fontSize: 10,
    fontWeight: 600,
    letterSpacing: "0.08em",
    textTransform: "uppercase" as const,
    color: "#48484a",
    fontFamily: "monospace",
    userSelect: "none" as const,
  },
  row: {
    borderBottom: "1px solid #1c1c1e",
    cursor: "pointer",
    transition: "background 0.1s",
  },
  rowSelected: {
    background: "#1a1a2e",
  },
  td: {
    padding: "10px 16px",
    verticalAlign: "middle",
  },
  sessionCell: {
    display: "flex",
    alignItems: "center",
    gap: 8,
  },
  dot: {
    width: 7,
    height: 7,
    borderRadius: "50%",
    flexShrink: 0,
  },
  sessionName: {
    color: "#f2f2f7",
    fontSize: 13,
    fontWeight: 500,
    fontFamily: "monospace",
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap" as const,
  },
  sessionId: {
    color: "#3a3a3c",
    fontSize: 10,
    fontFamily: "monospace",
    flexShrink: 0,
  },
  mono: {
    color: "#aeaeb2",
    fontSize: 12,
    fontFamily: "monospace",
    fontVariantNumeric: "tabular-nums",
  },
  barTrack: {
    position: "relative",
    height: 4,
    background: "#2c2c2e",
    borderRadius: 2,
    overflow: "hidden",
    marginBottom: 3,
  },
  barFill: {
    position: "absolute",
    top: 0,
    left: 0,
    height: "100%",
    borderRadius: 2,
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
    color: "#3a3a3c",
    fontSize: 10,
    fontFamily: "monospace",
  },
  badge: {
    display: "inline-block",
    padding: "2px 8px",
    borderRadius: 4,
    fontSize: 11,
    fontWeight: 600,
    fontFamily: "monospace",
    border: "1px solid",
  },
  empty: {
    padding: 32,
    textAlign: "center" as const,
    color: "#48484a",
    fontSize: 13,
    fontFamily: "monospace",
  },
};
