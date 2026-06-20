import { useState } from "react";
import { SessionRow, Project, GC_COLOR, GC_TEXT, gcState } from "../../types.js";
import { ActionOverflow, ActionOverflowType } from "../action-overflow.js";
import { policyOverflowAction } from "../policy/policy-action.js";
import { sessionTableStyles } from "./session-table-styles-config.js";
import { tokens } from "../../theme.js";

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
          ...sessionTableStyles.th,
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
    <div style={sessionTableStyles.container}>
      <table style={sessionTableStyles.table}>
        <thead>
          <tr style={sessionTableStyles.headerRow}>
            {col("Session", "name")}
            {col("Model", "model", "left", 120)}
            {col("Context", "current_ctx_pct", "left", 200)}
            {col("Cost", "cost_usd", "right", 150)}
            {col("Turns", "turn_count", "right", 80)}
            <th style={{ ...sessionTableStyles.th, width: 56 }} aria-label="Actions" />
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
            const project = s.project_id ? (projectById.get(s.project_id) ?? null) : null;
            const rowActions: ActionOverflowType[] = [
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
                  ...sessionTableStyles.row,
                  ...(isSelected && !isHardGC ? sessionTableStyles.rowSelected : {}),
                }}
                onClick={() => onSelect(s.id)}
              >
                {/* Session name — GC state stays legible via the dot + row tint */}
                <td style={sessionTableStyles.td}>
                  <div style={sessionTableStyles.sessionCell}>
                    <span className={`gc-dot gc-dot--${state}`} />
                    <span
                      style={{
                        ...sessionTableStyles.sessionName,
                        color: isHardGC ? GC_TEXT.hard_gc : tokens.highlight,
                      }}
                    >
                      {s.name ?? "unnamed"}
                    </span>
                    <span style={sessionTableStyles.sessionId}>{s.id.slice(0, 6)}</span>
                    {s.forked_from && (
                      <span
                        style={sessionTableStyles.forkBadge}
                        title={`Forked from ${s.forked_from.slice(0, 8)}`}
                      >
                        ⑂ {s.forked_from.slice(0, 6)}
                      </span>
                    )}
                  </div>
                </td>

                {/* Model */}
                <td style={sessionTableStyles.td}>
                  <span style={sessionTableStyles.mono}>{s.model.replace("claude-", "")}</span>
                </td>

                {/* Context — bar + inline %/tokens (collapses the old CTX% + GC cols) */}
                <td style={sessionTableStyles.td}>
                  <div style={sessionTableStyles.barTrack}>
                    <div
                      style={{
                        ...sessionTableStyles.barFill,
                        width: `${Math.min(pct * 100, 100)}%`,
                        background: dotColor,
                      }}
                    />
                    <div
                      style={{
                        ...sessionTableStyles.barZone,
                        left: "60%",
                        background: `${GC_COLOR.soft_gc}22`,
                      }}
                    />
                    <div
                      style={{
                        ...sessionTableStyles.barZone,
                        left: "80%",
                        width: "20%",
                        background: `${GC_COLOR.hard_gc}22`,
                      }}
                    />
                  </div>
                  <div style={sessionTableStyles.barMeta}>
                    <span style={{ ...sessionTableStyles.barPct, color: textColor }}>
                      {Math.min(pct * 100, 100).toFixed(1)}%
                    </span>
                    <span style={sessionTableStyles.barTokens}>
                      {approxTokens > 0 ? ` · ${(approxTokens / 1000).toFixed(1)}k` : ""}
                    </span>
                  </div>
                </td>

                {/* Cost — dollars + sparkbar (vs priciest) + $/turn */}
                <td style={{ ...sessionTableStyles.td, textAlign: "right" }}>
                  <div style={sessionTableStyles.costAmount}>
                    {s.pricing_fallback ? "~" : ""}${s.cost_usd.toFixed(2)}
                  </div>
                  <div style={sessionTableStyles.costTrack}>
                    <div
                      style={{
                        ...sessionTableStyles.costFill,
                        width: `${Math.min(costFrac * 100, 100)}%`,
                      }}
                    />
                  </div>
                  <div style={sessionTableStyles.costSub}>
                    {s.pricing_fallback ? "est. pricing" : `$${costPerTurn.toFixed(2)}/turn`}
                  </div>
                </td>

                {/* Turns */}
                <td style={{ ...sessionTableStyles.td, textAlign: "right" }}>
                  <span style={sessionTableStyles.mono}>{s.turn_count}</span>
                </td>

                {/* Row actions — Compact / Fork / Add to Knowledge Graph */}
                <td style={{ ...sessionTableStyles.td, textAlign: "right" }}>
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

      {sessions.length === 0 && (
        <div style={sessionTableStyles.empty}>No sessions — run bun run ingest</div>
      )}
    </div>
  );
}
