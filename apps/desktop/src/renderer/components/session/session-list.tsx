import { useState } from "react";
import { SessionRow, GC_COLOR, gcState } from "../../types.js";
import { sessionItemStyles } from "./session-list-styles-config.js";

type ViewMode = "project" | "turns" | "ctx_pct" | "cost";

interface SessionListProps {
  sessions: SessionRow[];
  selected: string | null;
  onSelect: (id: string) => void;
}

export function SessionList({ sessions, selected, onSelect }: SessionListProps) {
  const [view, setView] = useState<ViewMode>("project");
  const [openGroups, setOpenGroups] = useState<Set<string>>(new Set());

  function toggleGroup(key: string) {
    setOpenGroups((prev) => {
      const next = new Set(prev);
      next.has(key) ? next.delete(key) : next.add(key);
      return next;
    });
  }

  // ── Sorted / grouped lists ─────────────────────────────────────────────────

  const byTurns = [...sessions].sort((a, b) => b.turn_count - a.turn_count);

  const byCtx = [...sessions].sort((a, b) => (b.current_ctx_pct ?? 0) - (a.current_ctx_pct ?? 0));

  const byCost = [...sessions].sort((a, b) => b.cost_usd - a.cost_usd);

  // Group by name (project = cwd basename). Ungrouped = "unnamed"
  const projectGroups: Map<string, SessionRow[]> = new Map();
  for (const s of sessions) {
    const key = s.name ?? "unnamed";
    const arr = projectGroups.get(key) ?? [];
    arr.push(s);
    projectGroups.set(key, arr);
  }
  // Sort groups by max ctx_pct descending
  const sortedGroups = [...projectGroups.entries()].sort(
    ([, a], [, b]) =>
      Math.max(...b.map((s) => s.current_ctx_pct ?? 0)) -
      Math.max(...a.map((s) => s.current_ctx_pct ?? 0)),
  );

  // ── Render ─────────────────────────────────────────────────────────────────

  function renderFlat(list: SessionRow[], rankLabel: (s: SessionRow, i: number) => string) {
    return list.map((s, i) => (
      <div key={s.id} style={sessionItemStyles.rankedRow}>
        <span style={sessionItemStyles.rank}>{rankLabel(s, i)}</span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <SessionItem s={s} selected={selected} onSelect={onSelect} />
        </div>
      </div>
    ));
  }

  return (
    <div style={sessionItemStyles.container}>
      {/* Header + view switcher */}
      <div style={sessionItemStyles.header}>
        <span style={sessionItemStyles.headerLabel}>Sessions</span>
        <div style={sessionItemStyles.tabs}>
          {(["project", "turns", "ctx_pct", "cost"] as ViewMode[]).map((v) => (
            <button
              key={v}
              style={{
                ...sessionItemStyles.tab,
                ...(view === v ? sessionItemStyles.tabActive : {}),
              }}
              onClick={() => setView(v)}
            >
              {v === "project"
                ? "project"
                : v === "turns"
                  ? "turns"
                  : v === "ctx_pct"
                    ? "ctx%"
                    : "cost"}
            </button>
          ))}
        </div>
      </div>

      {sessions.length === 0 && (
        <div style={sessionItemStyles.empty}>No sessions — run bun run ingest</div>
      )}

      {/* Project tree view */}
      {view === "project" &&
        sortedGroups.map(([groupName, groupSessions]) => {
          const isOpen = openGroups.has(groupName);
          const maxCtx = Math.max(...groupSessions.map((s) => s.current_ctx_pct ?? 0));
          const totalCost = groupSessions.reduce((sum, s) => sum + s.cost_usd, 0);
          const costFallback = groupSessions.some((s) => s.pricing_fallback);
          return (
            <div key={groupName}>
              <GroupHeader
                label={groupName}
                count={groupSessions.length}
                maxCtxPct={maxCtx}
                totalCost={totalCost}
                costFallback={costFallback}
                open={isOpen}
                onToggle={() => toggleGroup(groupName)}
              />
              {isOpen &&
                groupSessions.map((s) => (
                  <SessionItem key={s.id} s={s} selected={selected} onSelect={onSelect} indent />
                ))}
            </div>
          );
        })}

      {/* Sorted by turns */}
      {view === "turns" && renderFlat(byTurns, (_, i) => `#${i + 1}`)}

      {/* Ranked by ctx% */}
      {view === "ctx_pct" &&
        renderFlat(byCtx, (s) => `${((s.current_ctx_pct ?? 0) * 100).toFixed(0)}%`)}

      {/* Ranked by cost — dollar amount shows per-row in the meta line */}
      {view === "cost" && renderFlat(byCost, (_, i) => `#${i + 1}`)}
    </div>
  );
}

function SessionItem({
  s,
  selected,
  onSelect,
  indent = false,
}: {
  s: SessionRow;
  selected: string | null;
  onSelect: (id: string) => void;
  indent?: boolean;
}) {
  const pct = s.current_ctx_pct ?? 0;
  const state = gcState(pct);
  const color = GC_COLOR[state];
  const isSelected = s.id === selected;

  return (
    <button
      style={{
        ...sessionItemStyles.row,
        ...(isSelected ? sessionItemStyles.rowSelected : {}),
        paddingLeft: indent ? 24 : 14,
      }}
      onClick={() => onSelect(s.id)}
    >
      <div style={sessionItemStyles.rowTop}>
        <span style={{ ...sessionItemStyles.dot, background: color }} />
        <span style={sessionItemStyles.name}>{s.name ?? "unnamed"}</span>
        <span style={{ ...sessionItemStyles.pct, color }}>{(pct * 100).toFixed(0)}%</span>
      </div>
      <div style={sessionItemStyles.rowBottom}>
        <span style={sessionItemStyles.meta}>
          {s.turn_count} turns · {s.model.replace("claude-", "")}
        </span>
        <span style={sessionItemStyles.metaCost}>
          {s.pricing_fallback ? "~" : ""}${s.cost_usd.toFixed(2)}
        </span>
      </div>
      <div style={sessionItemStyles.track}>
        <div
          style={{
            ...sessionItemStyles.fill,
            width: `${Math.min(pct * 100, 100)}%`,
            background: color,
          }}
        />
      </div>
    </button>
  );
}

function GroupHeader({
  label,
  count,
  maxCtxPct,
  totalCost,
  costFallback,
  open,
  onToggle,
}: {
  label: string;
  count: number;
  maxCtxPct: number;
  totalCost: number;
  costFallback: boolean;
  open: boolean;
  onToggle: () => void;
}) {
  const state = gcState(maxCtxPct);
  const color = GC_COLOR[state];
  return (
    <button style={sessionItemStyles.groupHeader} onClick={onToggle}>
      <span style={sessionItemStyles.chevron}>{open ? "▾" : "▸"}</span>
      <span style={sessionItemStyles.groupName}>{label}</span>
      <span style={sessionItemStyles.groupMeta}>{count}</span>
      <span style={sessionItemStyles.groupCost}>
        {costFallback ? "~" : ""}${totalCost.toFixed(2)}
      </span>
      <span style={{ ...sessionItemStyles.groupPct, color }}>{(maxCtxPct * 100).toFixed(0)}%</span>
    </button>
  );
}
