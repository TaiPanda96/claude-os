import React, { useState } from "react";
import { SessionRow, Project, GC_COLOR, GC_TEXT, gcState } from "../types.js";
import { tokens, gc } from "../theme.js";
import { ActionOverflow, OverflowAction } from "./action-overflow.js";
import { policyOverflowAction } from "./policy-action.js";

type SortKey = "name" | "model" | "current_ctx_pct" | "cost_usd" | "turn_count";
type SortDir = "asc" | "desc";

interface Props {
  sessions: SessionRow[];
  /** Projects, for resolving a session's policy state in the row overflow. */
  projects: Project[];
  selected: string | null;
  onSelect: (id: string) => void;
  /** Compact in place — prune the session destructively and continue. */
  onCompact?: (id: string) => void;
  /** Compact and fork — write memory.md and branch a fresh session. */
  onFork?: (id: string) => void;
  /** Open the policy panel for a session's project. */
  onConfigurePolicy?: (projectId: string) => void;
}

export function SessionTable({
  sessions,
  projects,
  selected,
  onSelect,
  onCompact,
  onFork,
  onConfigurePolicy,
}: Props) {
  const projectById = new Map(projects.map((p) => [p.id, p]));
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
          color: active ? tokens.highlight : tokens.muted,
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
            <th style={{ ...styles.th, width: 56 }} aria-label="Actions" />
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

            const hasTurns = s.turn_count > 0;
            const project = s.project_id ? projectById.get(s.project_id) ?? null : null;
            const rowActions: OverflowAction[] = [
              {
                key: "compact",
                glyph: "⊟",
                label: "Compact",
                description: "Prune session destructively & continue",
                danger: true,
                disabled: !hasTurns,
                onSelect: () => onCompact?.(s.id),
              },
              {
                key: "fork",
                glyph: "⑂",
                label: "Fork",
                description: "Compact & update memory.md",
                disabled: !hasTurns,
                onSelect: () => onFork?.(s.id),
              },
              ...(onConfigurePolicy ? [policyOverflowAction(project, onConfigurePolicy)] : []),
              {
                key: "knowledge-graph",
                glyph: "◈",
                label: "Add to Knowledge Graph",
                description: "Synthesize to invariant knowledge store",
                disabled: true,
                badge: "Soon",
              },
            ];

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

                {/* Row actions — Compact / Fork / Add to Knowledge Graph */}
                <td style={{ ...styles.td, textAlign: "right" }}>
                  <ActionOverflow
                    actions={rowActions}
                    ariaLabel={`Actions for ${s.name ?? s.id.slice(0, 6)}`}
                  />
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
    // separate (not collapse) + zero spacing: under borderCollapse:collapse Chromium
    // paints sticky <th> backgrounds transparently, letting scrolled rows bleed through.
    borderCollapse: "separate",
    borderSpacing: 0,
    tableLayout: "fixed",
  },
  headerRow: {},
  th: {
    // Sticky lives on the cells, not the <tr>/<thead> — with borderCollapse:collapse
    // Chromium drops sticky on row/section elements, so per-cell is the reliable path.
    position: "sticky" as const,
    top: 0,
    zIndex: 2,
    padding: "11px 16px",
    fontSize: tokens.fsMicro,
    fontWeight: 600,
    letterSpacing: "0.08em",
    textTransform: "uppercase" as const,
    color: tokens.muted,
    fontFamily: tokens.fontMono,
    userSelect: "none" as const,
    // Solid, distinct fill (not surface1, which sits on top of the row/void color
    // and reads as see-through) so scrolled rows can't bleed through the sticky cell.
    background: tokens.surface2,
    // boxShadow draws the divider instead of border — a collapsed border would
    // scroll out from under the sticky cell, leaving the header floating bare.
    boxShadow: `inset 0 -1px 0 ${tokens.border}`,
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
};
