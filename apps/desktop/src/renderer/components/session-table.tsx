import React, { useState } from "react";
import { SessionRow, GC_COLOR, GC_TEXT, GCState, gcState } from "../types.js";
import { tokens, gc } from "../theme.js";

const GC_LABEL: Record<GCState, string> = {
  clean: "Clean",
  soft_gc: "Soft GC",
  hard_gc: "Hard GC",
};

type SortKey = "name" | "model" | "current_ctx_pct" | "cost_usd" | "turn_count";
type SortDir = "asc" | "desc";

interface Props {
  sessions: SessionRow[];
  selected: string | null;
  onSelect: (id: string) => void;
  onCompactFork?: (id: string) => void;
}

export function SessionTable({ sessions, selected, onSelect, onCompactFork }: Props) {
  const [sortKey, setSortKey] = useState<SortKey>("current_ctx_pct");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const [hoveredId, setHoveredId] = useState<string | null>(null);

  function handleSort(key: SortKey) {
    if (key === sortKey) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir("desc");
    }
  }

  // Normalize the cost sparkbar against the priciest visible session.
  const maxCost = Math.max(0, ...sessions.map((s) => s.cost_usd));

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
      case "cost_usd":
        av = a.cost_usd;
        bv = b.cost_usd;
        break;
      case "turn_count":
        av = a.turn_count;
        bv = b.turn_count;
        break;
      case "current_ctx_pct":
      default:
        av = a.current_ctx_pct ?? 0;
        bv = b.current_ctx_pct ?? 0;
    }
    const cmp = av < bv ? -1 : av > bv ? 1 : 0;
    return sortDir === "asc" ? cmp : -cmp;
  });

  function col(label: string, key: SortKey, align: "left" | "right" = "left", width?: number) {
    const active = sortKey === key;
    return (
      <th
        style={{
          ...styles.th,
          ...(width ? { width } : {}),
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
            {col("Model", "model", "left", 120)}
            {col("Context", "current_ctx_pct", "left", 200)}
            {col("Cost", "cost_usd", "right", 150)}
            {col("Turns", "turn_count", "right", 80)}
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

            const costFrac = maxCost > 0 ? s.cost_usd / maxCost : 0;
            const costPerTurn = s.turn_count > 0 ? s.cost_usd / s.turn_count : 0;

            const rowClass = isHardGC ? "gc-row--hard_gc" : undefined;

            const isHovered = hoveredId === s.id;
            const canFork = state === "soft_gc" || state === "hard_gc";

            return (
              <tr
                key={s.id}
                className={rowClass}
                style={{
                  ...styles.row,
                  ...(isSelected && !isHardGC ? styles.rowSelected : {}),
                }}
                onClick={() => onSelect(s.id)}
                onMouseEnter={() => setHoveredId(s.id)}
                onMouseLeave={() => setHoveredId(null)}
              >
                {/* Session name — GC state stays legible via the dot + row tint */}
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
                    {s.forked_from && (
                      <span
                        style={styles.forkBadge}
                        title={`Forked from ${s.forked_from.slice(0, 8)}`}
                      >
                        ⑂ {s.forked_from.slice(0, 6)}
                      </span>
                    )}
                  </div>
                </td>

                {/* Model */}
                <td style={styles.td}>
                  <span style={styles.mono}>{s.model.replace("claude-", "")}</span>
                </td>

                {/* Context — bar + inline %/tokens (collapses the old CTX% + GC cols) */}
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
                  <div style={styles.barMeta}>
                    <span style={{ ...styles.barPct, color: textColor }}>
                      {Math.min(pct * 100, 100).toFixed(1)}%
                    </span>
                    <span style={styles.barTokens}>
                      {approxTokens > 0 ? ` · ${(approxTokens / 1000).toFixed(1)}k` : ""}
                    </span>
                  </div>
                </td>

                {/* Cost — dollars + sparkbar (vs priciest) + $/turn */}
                <td style={{ ...styles.td, textAlign: "right" }}>
                  <div style={styles.costAmount}>
                    {s.pricing_fallback ? "~" : ""}${s.cost_usd.toFixed(2)}
                  </div>
                  <div style={styles.costTrack}>
                    <div
                      style={{
                        ...styles.costFill,
                        width: `${Math.min(costFrac * 100, 100)}%`,
                      }}
                    />
                  </div>
                  <div style={styles.costSub}>
                    {s.pricing_fallback ? "est. pricing" : `$${costPerTurn.toFixed(2)}/turn`}
                  </div>
                </td>

                {/* Turns */}
                <td style={{ ...styles.td, textAlign: "right" }}>
                  <span style={styles.mono}>{s.turn_count}</span>
                </td>

                {/* GC State chip / Compact & Fork button on hover */}
                <td style={{ ...styles.td, textAlign: "right" }}>
                  {isHovered && canFork && onCompactFork ? (
                    <button
                      style={styles.compactForkBtn}
                      onClick={(e) => {
                        e.stopPropagation();
                        onCompactFork(s.id);
                      }}
                    >
                      ⑂ Compact &amp; Fork
                    </button>
                  ) : (
                    <span className={`gc-chip gc-chip--${state}`}>
                      <span className={`gc-dot gc-dot--${state}`} />
                      {GC_LABEL[state]}
                    </span>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>

      {sessions.length === 0 && <div style={styles.empty}>No sessions — run bun run ingest</div>}
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
  barMeta: {
    display: "flex",
    alignItems: "baseline",
    fontFamily: tokens.fontMono,
    fontSize: tokens.fsMicro,
  },
  barPct: {
    fontWeight: 600,
    fontVariantNumeric: "tabular-nums",
  },
  barTokens: {
    color: tokens.muted,
  },
  // Cost — neutral treatment so it never competes with the GC color language.
  costAmount: {
    color: tokens.text,
    fontSize: tokens.fsData,
    fontWeight: 600,
    fontFamily: tokens.fontMono,
    fontVariantNumeric: "tabular-nums",
  },
  costTrack: {
    height: 3,
    background: tokens.surface2,
    borderRadius: 999,
    overflow: "hidden",
    margin: "3px 0",
  },
  costFill: {
    height: "100%",
    borderRadius: 999,
    background: tokens.muted,
    transition: "width 0.4s ease",
  },
  costSub: {
    color: tokens.muted,
    fontSize: tokens.fsMicro,
    fontFamily: tokens.fontMono,
    fontVariantNumeric: "tabular-nums",
  },
  empty: {
    padding: 32,
    textAlign: "center" as const,
    color: tokens.muted,
    fontSize: tokens.fsBody,
    fontFamily: tokens.fontMono,
  },
  forkBadge: {
    fontSize: tokens.fsMicro,
    color: gc.soft_gc.text,
    fontFamily: tokens.fontMono,
    background: gc.soft_gc.bg,
    border: `1px solid ${gc.soft_gc.border}`,
    borderRadius: tokens.radiusPill,
    padding: "1px 6px",
    flexShrink: 0,
  },
  compactForkBtn: {
    background: gc.soft_gc.bg,
    border: `1px solid ${gc.soft_gc.border}`,
    borderRadius: tokens.radiusSm,
    color: gc.soft_gc.text,
    fontSize: tokens.fsMicro,
    fontFamily: tokens.fontMono,
    cursor: "pointer",
    padding: "3px 8px",
    fontWeight: 600,
    letterSpacing: "0.02em",
  },
};
