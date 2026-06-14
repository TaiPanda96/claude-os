import React, { useState } from "react";
import { SessionRow, GC_COLOR, gcState } from "../types.js";

type ViewMode = "project" | "turns" | "ctx_pct";

interface Props {
  sessions: SessionRow[];
  selected: string | null;
  onSelect: (id: string) => void;
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
        ...styles.row,
        ...(isSelected ? styles.rowSelected : {}),
        paddingLeft: indent ? 24 : 14,
      }}
      onClick={() => onSelect(s.id)}
    >
      <div style={styles.rowTop}>
        <span style={{ ...styles.dot, background: color }} />
        <span style={styles.name}>{s.name ?? "unnamed"}</span>
        <span style={{ ...styles.pct, color }}>{(pct * 100).toFixed(0)}%</span>
      </div>
      <div style={styles.rowBottom}>
        <span style={styles.meta}>{s.turn_count} turns</span>
        <span style={styles.meta}>{s.model.replace("claude-", "")}</span>
      </div>
      <div style={styles.track}>
        <div
          style={{
            ...styles.fill,
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
  open,
  onToggle,
}: {
  label: string;
  count: number;
  maxCtxPct: number;
  open: boolean;
  onToggle: () => void;
}) {
  const state = gcState(maxCtxPct);
  const color = GC_COLOR[state];
  return (
    <button style={styles.groupHeader} onClick={onToggle}>
      <span style={styles.chevron}>{open ? "▾" : "▸"}</span>
      <span style={styles.groupName}>{label}</span>
      <span style={styles.groupMeta}>{count}</span>
      <span style={{ ...styles.groupPct, color }}>
        {(maxCtxPct * 100).toFixed(0)}%
      </span>
    </button>
  );
}

export function SessionList({ sessions, selected, onSelect }: Props) {
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

  const byCtx = [...sessions].sort(
    (a, b) => (b.current_ctx_pct ?? 0) - (a.current_ctx_pct ?? 0),
  );

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

  function renderFlat(
    list: SessionRow[],
    rankLabel: (s: SessionRow, i: number) => string,
  ) {
    return list.map((s, i) => (
      <div key={s.id} style={styles.rankedRow}>
        <span style={styles.rank}>{rankLabel(s, i)}</span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <SessionItem s={s} selected={selected} onSelect={onSelect} />
        </div>
      </div>
    ));
  }

  return (
    <div style={styles.container}>
      {/* Header + view switcher */}
      <div style={styles.header}>
        <span style={styles.headerLabel}>Sessions</span>
        <div style={styles.tabs}>
          {(["project", "turns", "ctx_pct"] as ViewMode[]).map((v) => (
            <button
              key={v}
              style={{ ...styles.tab, ...(view === v ? styles.tabActive : {}) }}
              onClick={() => setView(v)}
            >
              {v === "project" ? "project" : v === "turns" ? "turns" : "ctx%"}
            </button>
          ))}
        </div>
      </div>

      {sessions.length === 0 && (
        <div style={styles.empty}>No sessions — run bun run ingest</div>
      )}

      {/* Project tree view */}
      {view === "project" &&
        sortedGroups.map(([groupName, groupSessions]) => {
          const isOpen = openGroups.has(groupName);
          const maxCtx = Math.max(
            ...groupSessions.map((s) => s.current_ctx_pct ?? 0),
          );
          return (
            <div key={groupName}>
              <GroupHeader
                label={groupName}
                count={groupSessions.length}
                maxCtxPct={maxCtx}
                open={isOpen}
                onToggle={() => toggleGroup(groupName)}
              />
              {isOpen &&
                groupSessions.map((s) => (
                  <SessionItem
                    key={s.id}
                    s={s}
                    selected={selected}
                    onSelect={onSelect}
                    indent
                  />
                ))}
            </div>
          );
        })}

      {/* Sorted by turns */}
      {view === "turns" && renderFlat(byTurns, (_, i) => `#${i + 1}`)}

      {/* Ranked by ctx% */}
      {view === "ctx_pct" &&
        renderFlat(
          byCtx,
          (s) => `${((s.current_ctx_pct ?? 0) * 100).toFixed(0)}%`,
        )}
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    width: 240,
    borderRight: "1px solid #2c2c2e",
    overflowY: "auto",
    flexShrink: 0,
    background: "#111113",
    display: "flex",
    flexDirection: "column",
  },
  header: {
    padding: "10px 12px 8px",
    borderBottom: "1px solid #2c2c2e",
    background: "#111113",
    position: "sticky",
    top: 0,
    zIndex: 1,
  },
  headerLabel: {
    fontSize: 11,
    fontWeight: 600,
    letterSpacing: "0.08em",
    textTransform: "uppercase" as const,
    color: "#636366",
    display: "block",
    marginBottom: 8,
  },
  tabs: {
    display: "flex",
    gap: 2,
  },
  tab: {
    flex: 1,
    padding: "4px 0",
    fontSize: 10,
    fontFamily: "monospace",
    background: "transparent",
    border: "1px solid #2c2c2e",
    borderRadius: 4,
    color: "#48484a",
    cursor: "pointer",
    letterSpacing: "0.03em",
  },
  tabActive: {
    background: "#2c2c2e",
    color: "#f2f2f7",
    borderColor: "#3a3a3c",
  },
  empty: {
    padding: 16,
    color: "#48484a",
    fontSize: 12,
    fontFamily: "monospace",
  },
  groupHeader: {
    display: "flex",
    alignItems: "center",
    gap: 6,
    width: "100%",
    padding: "8px 12px",
    background: "transparent",
    border: "none",
    borderBottom: "1px solid #1c1c1e",
    cursor: "pointer",
    textAlign: "left" as const,
  },
  chevron: {
    fontSize: 9,
    color: "#48484a",
    flexShrink: 0,
    width: 10,
  },
  groupName: {
    flex: 1,
    fontSize: 12,
    fontWeight: 600,
    color: "#aeaeb2",
    fontFamily: "monospace",
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap" as const,
  },
  groupMeta: {
    fontSize: 10,
    color: "#48484a",
    fontFamily: "monospace",
    marginRight: 4,
  },
  groupPct: {
    fontSize: 11,
    fontWeight: 600,
    fontFamily: "monospace",
    fontVariantNumeric: "tabular-nums",
  },
  rankedRow: {
    display: "flex",
    alignItems: "stretch",
    borderBottom: "1px solid #1c1c1e",
  },
  rank: {
    width: 32,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    fontSize: 10,
    color: "#48484a",
    fontFamily: "monospace",
    flexShrink: 0,
    borderRight: "1px solid #1c1c1e",
  },
  row: {
    display: "block",
    width: "100%",
    padding: "10px 14px",
    background: "transparent",
    border: "none",
    borderBottom: "1px solid #1c1c1e",
    cursor: "pointer",
    textAlign: "left" as const,
    transition: "background 0.1s",
  },
  rowSelected: {
    background: "#1c1c1e",
  },
  rowTop: {
    display: "flex",
    alignItems: "center",
    gap: 6,
    marginBottom: 4,
  },
  dot: {
    width: 7,
    height: 7,
    borderRadius: "50%",
    flexShrink: 0,
  },
  name: {
    flex: 1,
    color: "#f2f2f7",
    fontSize: 13,
    fontWeight: 500,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap" as const,
  },
  pct: {
    fontSize: 12,
    fontWeight: 600,
    fontVariantNumeric: "tabular-nums",
  },
  rowBottom: {
    display: "flex",
    justifyContent: "space-between",
    marginBottom: 7,
  },
  meta: {
    color: "#48484a",
    fontSize: 11,
  },
  track: {
    height: 2,
    background: "#2c2c2e",
    borderRadius: 1,
    overflow: "hidden",
  },
  fill: {
    height: "100%",
    borderRadius: 1,
    transition: "width 0.4s ease",
  },
};
