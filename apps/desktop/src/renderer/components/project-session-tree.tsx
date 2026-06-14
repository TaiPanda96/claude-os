import React, { useState } from "react";
import { SessionRow, GCState, gcState } from "../types.js";
import { tokens, gc } from "../theme.js";

interface Props {
  sessions: SessionRow[];
  ttlDays: number;
  selected: string | null;
  onSelect: (id: string) => void;
  onSelectProject: (projectId: string) => void;
}

interface ProjectGroup {
  id: string | null;
  name: string;
  sessions: SessionRow[];
}

const GC_LABEL: Record<GCState, string> = {
  clean: "Clean",
  soft_gc: "Soft GC",
  hard_gc: "Hard GC",
};

// Urgency rank: hard_gc = 0, soft_gc = 1, clean = 2
function urgencyRank(s: SessionRow): number {
  const state = gcState(s.current_ctx_pct ?? 0);
  return state === "hard_gc" ? 0 : state === "soft_gc" ? 1 : 2;
}

function worstState(sessions: SessionRow[]): GCState {
  if (sessions.some((s) => gcState(s.current_ctx_pct ?? 0) === "hard_gc")) return "hard_gc";
  if (sessions.some((s) => gcState(s.current_ctx_pct ?? 0) === "soft_gc")) return "soft_gc";
  return "clean";
}

function relativeTime(ms: number): string {
  const diff = Date.now() - ms;
  const m = Math.floor(diff / 60_000);
  const h = Math.floor(diff / 3_600_000);
  const d = Math.floor(diff / 86_400_000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  if (h < 24) return `${h}h ago`;
  return `${d}d ago`;
}

export function ProjectSessionTree({
  sessions,
  ttlDays,
  selected,
  onSelect,
  onSelectProject,
}: Props) {
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [showStale, setShowStale] = useState<Set<string>>(new Set());

  const cutoff = ttlDays > 0 ? Date.now() - ttlDays * 86_400_000 : 0;

  // Group by project_id client-side
  const groupMap = new Map<string, ProjectGroup>();
  for (const s of sessions) {
    const key = s.project_id ?? "__ungrouped__";
    if (!groupMap.has(key)) {
      groupMap.set(key, {
        id: s.project_id,
        name: s.project_name ?? "Ungrouped",
        sessions: [],
      });
    }
    groupMap.get(key)!.sessions.push(s);
  }

  // Sort groups: worst GC state first, then by most recent session
  const groups = [...groupMap.values()].sort((a, b) => {
    const aw = worstState(a.sessions);
    const bw = worstState(b.sessions);
    const urgencyMap = { hard_gc: 0, soft_gc: 1, clean: 2 };
    const ud = urgencyMap[aw] - urgencyMap[bw];
    if (ud !== 0) return ud;
    const aLast = Math.max(...a.sessions.map((s) => s.last_active_at));
    const bLast = Math.max(...b.sessions.map((s) => s.last_active_at));
    return bLast - aLast;
  });

  if (groups.length === 0) {
    return (
      <div style={styles.empty}>
        No sessions in the last {ttlDays} day{ttlDays !== 1 ? "s" : ""} — try a longer window or run{" "}
        <code style={{ color: tokens.highlight }}>bun run ingest</code>
      </div>
    );
  }

  return (
    <div style={styles.container}>
      {groups.map((group) => {
        const key = group.id ?? "__ungrouped__";
        const isCollapsed = collapsed.has(key);
        const worst = worstState(group.sessions);
        const gcColors = gc[worst];

        // Partition into fresh vs stale
        const fresh = group.sessions
          .filter((s) => s.last_active_at >= cutoff)
          .sort((a, b) => urgencyRank(a) - urgencyRank(b) || b.last_active_at - a.last_active_at);
        const stale = group.sessions
          .filter((s) => s.last_active_at < cutoff)
          .sort((a, b) => b.last_active_at - a.last_active_at);
        const isShowingStale = showStale.has(key);

        return (
          <div key={key} style={styles.group}>
            {/* Project header */}
            <div
              style={styles.projectHeader}
              onClick={() =>
                setCollapsed((prev) => {
                  const next = new Set(prev);
                  next.has(key) ? next.delete(key) : next.add(key);
                  return next;
                })
              }
            >
              <span
                style={{
                  ...styles.chevron,
                  transform: isCollapsed ? "rotate(-90deg)" : "rotate(0deg)",
                }}
              >
                ▾
              </span>
              <span style={{ ...styles.projectDot, background: gcColors.dot }} />
              <span style={styles.projectName}>{group.name}</span>
              <span style={styles.projectCount}>
                {group.sessions.length} session{group.sessions.length !== 1 ? "s" : ""}
              </span>
              <span
                style={{
                  ...styles.gcChip,
                  color: gcColors.text,
                  background: gcColors.bg,
                  border: `0.5px solid ${gcColors.border}`,
                }}
              >
                {GC_LABEL[worst]}
              </span>
              {/* Policy button — stops propagation so collapse doesn't fire */}
              {group.id && (
                <button
                  style={styles.policyBtn}
                  onClick={(e) => {
                    e.stopPropagation();
                    onSelectProject(group.id!);
                  }}
                >
                  ⚙ Policy
                </button>
              )}
            </div>

            {/* Session rows */}
            {!isCollapsed && (
              <>
                {fresh.map((s) => (
                  <SessionRowComponent
                    key={s.id}
                    session={s}
                    isSelected={s.id === selected}
                    onSelect={onSelect}
                  />
                ))}

                {stale.length > 0 && (
                  <button
                    style={styles.staleToggle}
                    onClick={() =>
                      setShowStale((prev) => {
                        const next = new Set(prev);
                        next.has(key) ? next.delete(key) : next.add(key);
                        return next;
                      })
                    }
                  >
                    {isShowingStale ? "▴ hide" : `▾ ${stale.length} older`}
                  </button>
                )}

                {isShowingStale &&
                  stale.map((s) => (
                    <SessionRowComponent
                      key={s.id}
                      session={s}
                      isSelected={s.id === selected}
                      onSelect={onSelect}
                      dimmed
                    />
                  ))}
              </>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ── Session row ───────────────────────────────────────────────────────────────

function SessionRowComponent({
  session: s,
  isSelected,
  onSelect,
  dimmed = false,
}: {
  session: SessionRow;
  isSelected: boolean;
  onSelect: (id: string) => void;
  dimmed?: boolean;
}) {
  const pct = s.current_ctx_pct ?? 0;
  const state = gcState(pct);
  const gcColors = gc[state];

  return (
    <div
      style={{
        ...styles.sessionRow,
        ...(isSelected ? styles.sessionRowSelected : {}),
        opacity: dimmed ? 0.45 : 1,
      }}
      onClick={() => onSelect(s.id)}
    >
      {/* Indent + dot */}
      <div style={styles.sessionLeft}>
        <span style={styles.indent} />
        <span style={{ ...styles.dot, background: gcColors.dot }} />
        <span
          style={{
            ...styles.sessionName,
            color: state === "hard_gc" ? gcColors.text : tokens.highlight,
          }}
        >
          {s.name ?? "unnamed"}
        </span>
        <span style={styles.sessionId}>{s.id.slice(0, 6)}</span>
      </div>

      {/* Context bar */}
      <div style={styles.barWrap}>
        <div style={styles.barTrack}>
          <div
            style={{
              ...styles.barFill,
              width: `${Math.min(pct * 100, 100)}%`,
              background: gcColors.dot,
            }}
          />
          <div style={{ ...styles.barZone, left: "60%", background: `${gc.soft_gc.dot}22` }} />
          <div
            style={{
              ...styles.barZone,
              left: "80%",
              width: "20%",
              background: `${gc.hard_gc.dot}22`,
            }}
          />
        </div>
      </div>

      {/* ctx % */}
      <span style={{ ...styles.pct, color: gcColors.text }}>
        {(Math.min(pct, 1) * 100).toFixed(0)}%
      </span>

      {/* GC chip */}
      <span
        style={{
          ...styles.gcChip,
          color: gcColors.text,
          background: gcColors.bg,
          border: `0.5px solid ${gcColors.border}`,
        }}
      >
        {GC_LABEL[state]}
      </span>

      {/* Last active */}
      <span style={styles.time}>{relativeTime(s.last_active_at)}</span>
    </div>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────

const SANS = "-apple-system, BlinkMacSystemFont, 'SF Pro Display', 'SF Pro Text', system-ui, sans-serif";

const styles: Record<string, React.CSSProperties> = {
  container: {
    flex: 1,
    overflowY: "auto",
    background: tokens.void,
  },
  empty: {
    padding: "48px 32px",
    textAlign: "center",
    color: tokens.muted,
    fontSize: tokens.fsBody,
    fontFamily: tokens.fontMono,
    lineHeight: 1.8,
  },
  // Groups get a clear visual break — heavier border between projects
  group: {
    borderBottom: `1px solid ${tokens.border}`,
  },
  projectHeader: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    padding: "12px 20px",
    minHeight: 48,
    background: tokens.surface0,
    cursor: "pointer",
    userSelect: "none",
    position: "sticky" as const,
    top: 0,
    zIndex: 1,
    borderBottom: `0.5px solid ${tokens.surface1}`,
  },
  chevron: {
    color: tokens.muted,
    fontSize: 10,
    transition: "transform 0.15s ease",
    flexShrink: 0,
    lineHeight: 1,
  },
  projectDot: {
    width: 8,
    height: 8,
    borderRadius: "50%",
    flexShrink: 0,
  },
  // Project names use system UI — they're labels, not data
  projectName: {
    fontSize: 14,
    fontWeight: 600,
    color: tokens.highlight,
    fontFamily: SANS,
    letterSpacing: "-0.01em",
    flex: 1,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap" as const,
  },
  projectCount: {
    fontSize: tokens.fsMicro,
    color: tokens.muted,
    fontFamily: tokens.fontMono,
    flexShrink: 0,
    letterSpacing: "0.02em",
  },
  gcChip: {
    fontSize: tokens.fsMicro,
    padding: "3px 8px",
    borderRadius: tokens.radiusSm,
    fontFamily: tokens.fontMono,
    fontWeight: 500,
    letterSpacing: "0.04em",
    flexShrink: 0,
  },
  policyBtn: {
    background: tokens.surface2,
    border: `0.5px solid ${tokens.border}`,
    borderRadius: tokens.radiusSm,
    color: tokens.highlight,
    fontSize: tokens.fsMicro,
    fontFamily: tokens.fontMono,
    fontWeight: 500,
    letterSpacing: "0.04em",
    cursor: "pointer",
    padding: "4px 9px",
    lineHeight: 1,
    flexShrink: 0,
  },
  sessionRow: {
    display: "grid",
    gridTemplateColumns: "1fr 140px 48px 80px 72px",
    alignItems: "center",
    gap: 12,
    padding: "10px 20px 10px 0",
    borderBottom: `0.5px solid ${tokens.surface1}`,
    cursor: "pointer",
    transition: "background 0.15s",
    minHeight: 40,
  },
  sessionRowSelected: {
    background: tokens.surface2,
  },
  sessionLeft: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    overflow: "hidden",
    paddingLeft: 4,
  },
  indent: {
    width: 32,
    flexShrink: 0,
  },
  dot: {
    width: 7,
    height: 7,
    borderRadius: "50%",
    flexShrink: 0,
  },
  // Session names: system UI for readability, mono only for IDs and data
  sessionName: {
    fontSize: tokens.fsBody,
    fontWeight: 500,
    fontFamily: SANS,
    letterSpacing: "-0.01em",
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
  barWrap: {
    display: "flex",
    alignItems: "center",
  },
  barTrack: {
    position: "relative",
    width: "100%",
    height: 4,
    background: tokens.surface2,
    borderRadius: 999,
    overflow: "hidden",
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
  pct: {
    fontSize: tokens.fsData,
    fontFamily: tokens.fontMono,
    fontWeight: 600,
    textAlign: "right",
    fontVariantNumeric: "tabular-nums",
  },
  time: {
    fontSize: tokens.fsMicro,
    color: tokens.muted,
    fontFamily: tokens.fontMono,
    textAlign: "right",
    fontVariantNumeric: "tabular-nums",
  },
  staleToggle: {
    display: "block",
    width: "100%",
    padding: "7px 20px 7px 56px",
    background: "transparent",
    border: "none",
    borderBottom: `0.5px solid ${tokens.surface1}`,
    color: tokens.muted,
    fontSize: tokens.fsMicro,
    fontFamily: tokens.fontMono,
    cursor: "pointer",
    textAlign: "left" as const,
    letterSpacing: "0.04em",
  },
};
