import React, { useState } from "react";
import { SessionRow, Project, GCState, gcState } from "../types.js";
import { tokens, gc } from "../theme.js";

type ViewMode = "project" | "session";

interface Props {
  sessions: SessionRow[];
  projects: Project[];
  view: ViewMode;
  ttlDays: number;
  selected: string | null;
  onSelect: (id: string) => void;
  onSelectProject: (projectId: string) => void;
  onCompactFork?: (id: string) => void;
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
  projects,
  view,
  ttlDays,
  selected,
  onSelect,
  onSelectProject,
  onCompactFork,
}: Props) {
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [showStale, setShowStale] = useState<Set<string>>(new Set());

  const cutoff = ttlDays > 0 ? Date.now() - ttlDays * 86_400_000 : 0;
  const projectById = new Map(projects.map((p) => [p.id, p]));

  if (sessions.length === 0) {
    return (
      <div style={styles.empty}>
        No sessions in the last {ttlDays} day{ttlDays !== 1 ? "s" : ""} — try a longer window or run{" "}
        <code style={{ color: tokens.highlight }}>bun run ingest</code>
      </div>
    );
  }

  // ── Session view: one flat, urgency-sorted list, project shown inline ──────────
  if (view === "session") {
    const fresh = sessions
      .filter((s) => s.last_active_at >= cutoff)
      .sort((a, b) => urgencyRank(a) - urgencyRank(b) || b.last_active_at - a.last_active_at);
    const stale = sessions
      .filter((s) => s.last_active_at < cutoff)
      .sort((a, b) => b.last_active_at - a.last_active_at);
    const isShowingStale = showStale.has("__all__");

    return (
      <div style={styles.container}>
        <div style={styles.flatHeader}>
          <span style={styles.flatHeaderLabel}>All sessions</span>
          <span style={styles.flatHeaderCount}>
            {fresh.length} active{stale.length > 0 ? ` · ${stale.length} older` : ""}
          </span>
        </div>

        {fresh.map((s) => (
          <SessionRowComponent
            key={s.id}
            session={s}
            isSelected={s.id === selected}
            onSelect={onSelect}
            {...(onCompactFork ? { onCompactFork } : {})}
            showProject
          />
        ))}

        {stale.length > 0 && (
          <button
            style={styles.staleToggle}
            onClick={() =>
              setShowStale((prev) => {
                const next = new Set(prev);
                next.has("__all__") ? next.delete("__all__") : next.add("__all__");
                return next;
              })
            }
          >
            {isShowingStale ? "▴ hide older" : `▾ ${stale.length} older`}
          </button>
        )}

        {isShowingStale &&
          stale.map((s) => (
            <SessionRowComponent
              key={s.id}
              session={s}
              isSelected={s.id === selected}
              onSelect={onSelect}
              {...(onCompactFork ? { onCompactFork } : {})}
              showProject
              dimmed
            />
          ))}
      </div>
    );
  }

  // ── Project view: sessions grouped under their project, with policy banner ─────

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
    const urgencyMap = { hard_gc: 0, soft_gc: 1, clean: 2 };
    const ud = urgencyMap[worstState(a.sessions)] - urgencyMap[worstState(b.sessions)];
    if (ud !== 0) return ud;
    const aLast = Math.max(...a.sessions.map((s) => s.last_active_at));
    const bLast = Math.max(...b.sessions.map((s) => s.last_active_at));
    return bLast - aLast;
  });

  return (
    <div style={styles.container}>
      {groups.map((group) => {
        const key = group.id ?? "__ungrouped__";
        const isCollapsed = collapsed.has(key);
        const worst = worstState(group.sessions);
        const gcColors = gc[worst];
        const project = group.id ? projectById.get(group.id) ?? null : null;

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
            {/* Project header — identity + aggregate state */}
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
              <span style={styles.projectKindTag}>PROJECT</span>
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
            </div>

            {/* Policy banner — project-level, always visible (distinct from sessions) */}
            {group.id && project && (
              <PolicyBanner
                project={project}
                onEdit={() => onSelectProject(group.id!)}
              />
            )}

            {/* Session rows */}
            {!isCollapsed && (
              <>
                {fresh.map((s) => (
                  <SessionRowComponent
                    key={s.id}
                    session={s}
                    isSelected={s.id === selected}
                    onSelect={onSelect}
                    {...(onCompactFork ? { onCompactFork } : {})}
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
                      {...(onCompactFork ? { onCompactFork } : {})}
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

// ── Policy banner ───────────────────────────────────────────────────────────────
// Project-scoped strip: surfaces whether a compaction policy is configured and
// active, and hosts the project-level actions. Deliberately styled apart from
// session rows so the project/session topology reads clearly.

function PolicyBanner({
  project,
  onEdit,
}: {
  project: Project | null;
  onEdit: () => void;
}) {
  const hasPolicy = project?.has_policy === 1;
  const isActive = project?.policy_active === 1;

  const status = !hasPolicy
    ? { dot: tokens.muted, text: tokens.muted, label: "No policy configured" }
    : isActive
      ? { dot: gc.clean.dot, text: gc.clean.text, label: `Policy active${project?.policy_name ? ` · ${project.policy_name}` : ""}` }
      : { dot: gc.soft_gc.dot, text: gc.soft_gc.text, label: `Policy paused${project?.policy_name ? ` · ${project.policy_name}` : ""}` };

  return (
    <div style={styles.policyBanner}>
      <span style={styles.indent} />
      <span style={{ ...styles.policyStatusDot, background: status.dot }} />
      <span style={{ ...styles.policyStatusText, color: status.text }}>{status.label}</span>

      <div style={styles.policyActions}>
        <button style={styles.editPolicyBtn} onClick={onEdit}>
          {hasPolicy ? "Edit Policy" : "Configure Policy"}
        </button>
        {/* Placeholder — context-window optimisation lands in a later phase */}
        <button
          style={styles.optimizeBtn}
          disabled
          title="Coming soon — automatically compact the active context window"
        >
          Optimize Context Window
        </button>
      </div>
    </div>
  );
}

// ── Session row ───────────────────────────────────────────────────────────────

function SessionRowComponent({
  session: s,
  isSelected,
  onSelect,
  onCompactFork,
  showProject = false,
  dimmed = false,
}: {
  session: SessionRow;
  isSelected: boolean;
  onSelect: (id: string) => void;
  onCompactFork?: (id: string) => void;
  showProject?: boolean;
  dimmed?: boolean;
}) {
  const [hovered, setHovered] = React.useState(false);
  const pct = s.current_ctx_pct ?? 0;
  const state = gcState(pct);
  const gcColors = gc[state];
  const canFork = state === "soft_gc" || state === "hard_gc";

  return (
    <div
      style={{
        ...styles.sessionRow,
        ...(isSelected ? styles.sessionRowSelected : {}),
        opacity: dimmed ? 0.45 : 1,
      }}
      onClick={() => onSelect(s.id)}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
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
        {showProject && (
          <span style={styles.projectTag}>{s.project_name ?? "Ungrouped"}</span>
        )}
        <span style={styles.sessionId}>{s.id.slice(0, 6)}</span>
        {s.forked_from && (
          <span style={styles.forkBadge} title={`Forked from ${s.forked_from.slice(0, 8)}`}>
            ⑂
          </span>
        )}
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

      {/* GC chip / Compact & Fork button on hover */}
      {hovered && canFork && onCompactFork ? (
        <button
          style={styles.compactForkBtn}
          onClick={(e) => {
            e.stopPropagation();
            onCompactFork(s.id);
          }}
        >
          ⑂ Fork
        </button>
      ) : (
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
      )}

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
  // Topology label — marks this row as the project (vs. session) altitude
  projectKindTag: {
    fontSize: 8,
    fontWeight: 700,
    letterSpacing: "0.12em",
    color: tokens.muted,
    background: tokens.surface2,
    borderRadius: tokens.radiusXs,
    padding: "2px 5px",
    flexShrink: 0,
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
  // Policy banner — sits between project header and its sessions
  policyBanner: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    padding: "7px 20px 7px 0",
    background: tokens.void,
    borderBottom: `0.5px solid ${tokens.surface1}`,
    minHeight: 34,
  },
  policyStatusDot: {
    width: 6,
    height: 6,
    borderRadius: "50%",
    flexShrink: 0,
  },
  policyStatusText: {
    fontSize: tokens.fsMicro,
    fontFamily: tokens.fontMono,
    letterSpacing: "0.03em",
    flex: 1,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap" as const,
  },
  policyActions: {
    display: "flex",
    alignItems: "center",
    gap: 6,
    flexShrink: 0,
  },
  editPolicyBtn: {
    background: tokens.surface2,
    border: `0.5px solid ${tokens.border}`,
    borderRadius: tokens.radiusSm,
    color: tokens.highlight,
    fontSize: tokens.fsMicro,
    fontFamily: tokens.fontMono,
    fontWeight: 500,
    letterSpacing: "0.03em",
    cursor: "pointer",
    padding: "4px 10px",
    lineHeight: 1,
  },
  optimizeBtn: {
    background: "transparent",
    border: `0.5px dashed ${tokens.surface2}`,
    borderRadius: tokens.radiusSm,
    color: tokens.muted,
    fontSize: tokens.fsMicro,
    fontFamily: tokens.fontMono,
    letterSpacing: "0.03em",
    cursor: "not-allowed",
    padding: "4px 10px",
    lineHeight: 1,
    opacity: 0.55,
  },
  // Flat-list header for session view
  flatHeader: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    padding: "12px 20px",
    minHeight: 44,
    background: tokens.surface0,
    position: "sticky" as const,
    top: 0,
    zIndex: 1,
    borderBottom: `0.5px solid ${tokens.border}`,
  },
  flatHeaderLabel: {
    fontSize: 14,
    fontWeight: 600,
    color: tokens.highlight,
    fontFamily: SANS,
    letterSpacing: "-0.01em",
    flex: 1,
  },
  flatHeaderCount: {
    fontSize: tokens.fsMicro,
    color: tokens.muted,
    fontFamily: tokens.fontMono,
    letterSpacing: "0.02em",
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
  // Project provenance tag — only shown in flat session view
  projectTag: {
    fontSize: tokens.fsMicro,
    color: tokens.muted,
    fontFamily: tokens.fontMono,
    background: tokens.surface1,
    border: `0.5px solid ${tokens.surface2}`,
    borderRadius: tokens.radiusXs,
    padding: "1px 6px",
    flexShrink: 0,
    maxWidth: 140,
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
  forkBadge: {
    fontSize: tokens.fsMicro,
    color: gc.soft_gc.text,
    fontFamily: tokens.fontMono,
    opacity: 0.8,
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
    padding: "2px 7px",
    fontWeight: 600,
    letterSpacing: "0.02em",
    flexShrink: 0,
  },
};
