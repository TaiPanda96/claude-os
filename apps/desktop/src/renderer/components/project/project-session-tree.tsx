import { useState } from "react";
import { SessionRow, Project, GCState, gcState } from "../../types.js";
import { tokens, gc } from "../../theme.js";
import { GC_LABEL } from "../garbage-compaction-labels.js";
import { SessionRowComponent } from "../session/session-row-component.js";
import { PolicyBanner } from "../policy/policy-banner.js";
import { projectSessionTreeStyles } from "./project-session-tree-styles-config.js";

type ViewMode = "project" | "session";

interface ProjectSessionTreeProps {
  sessions: SessionRow[];
  projects: Project[];
  view: ViewMode;
  ttlDays: number;
  selected: string | null;
  // Callbacks for session actions; passed down to SessionRowComponent.
  // Optional to allow flexibility in which actions are surfaced per view, and to omit actions that aren't relevant in certain contexts (e.g. compact/fork in a read-only memory explorer).
  onSelect: (id: string) => void;
  onSelectProject: (projectId: string) => void;
  onViewMemory?: (projectId: string) => void;
  /** Compact in place — prune destructively and continue. */
  onCompact?: (id: string) => void;
  /** Compact and fork — write memory.md and branch a fresh session. */
  onCompactFork?: (id: string) => void;
}

interface ProjectGroup {
  id: string | null;
  name: string;
  sessions: SessionRow[];
}

export function ProjectSessionTree({
  sessions,
  projects,
  view,
  ttlDays,
  selected,
  onSelect,
  onSelectProject,
  onViewMemory,
  onCompact,
  onCompactFork,
}: ProjectSessionTreeProps) {
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [showStale, setShowStale] = useState<Set<string>>(new Set());

  const cutoff = ttlDays > 0 ? Date.now() - ttlDays * 86_400_000 : 0;
  const projectById = new Map(projects.map((p) => [p.id, p]));

  // Per-session action handlers shared across every SessionRowComponent call site;
  // conditionally spread so an omitted optional prop stays absent (exactOptionalPropertyTypes).
  const rowActionProps = {
    ...(onCompact ? { onCompact } : {}),
    ...(onCompactFork ? { onCompactFork } : {}),
    onConfigurePolicy: onSelectProject,
  };

  function projectOf(s: SessionRow): Project | null {
    return s.project_id ? (projectById.get(s.project_id) ?? null) : null;
  }

  if (sessions.length === 0) {
    return (
      <div style={projectSessionTreeStyles.empty}>
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
      <div style={projectSessionTreeStyles.container}>
        <div style={projectSessionTreeStyles.flatHeader}>
          <span style={projectSessionTreeStyles.flatHeaderLabel}>All sessions</span>
          <span style={projectSessionTreeStyles.flatHeaderCount}>
            {fresh.length} active{stale.length > 0 ? ` · ${stale.length} older` : ""}
          </span>
        </div>

        {fresh.map((s) => (
          <SessionRowComponent
            key={s.id}
            session={s}
            project={projectOf(s)}
            isSelected={s.id === selected}
            onSelect={onSelect}
            {...rowActionProps}
            showProject
          />
        ))}

        {stale.length > 0 && (
          <button
            style={projectSessionTreeStyles.staleToggle}
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
              project={projectOf(s)}
              isSelected={s.id === selected}
              onSelect={onSelect}
              {...rowActionProps}
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
    <div style={projectSessionTreeStyles.container}>
      {groups.map((group) => {
        const key = group.id ?? "__ungrouped__";
        const isCollapsed = collapsed.has(key);
        const worst = worstState(group.sessions);
        const gcColors = gc[worst];
        const project = group.id ? (projectById.get(group.id) ?? null) : null;

        // Partition into fresh vs stale
        const fresh = group.sessions
          .filter((s) => s.last_active_at >= cutoff)
          .sort((a, b) => urgencyRank(a) - urgencyRank(b) || b.last_active_at - a.last_active_at);
        const stale = group.sessions
          .filter((s) => s.last_active_at < cutoff)
          .sort((a, b) => b.last_active_at - a.last_active_at);
        const isShowingStale = showStale.has(key);

        return (
          <div key={key} style={projectSessionTreeStyles.group}>
            {/* Project header — identity + aggregate state */}
            <div
              style={projectSessionTreeStyles.projectHeader}
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
                  ...projectSessionTreeStyles.chevron,
                  transform: isCollapsed ? "rotate(-90deg)" : "rotate(0deg)",
                }}
              >
                ▾
              </span>
              <span style={projectSessionTreeStyles.projectKindTag}>PROJECT</span>
              <span style={{ ...projectSessionTreeStyles.projectDot, background: gcColors.dot }} />
              <span style={projectSessionTreeStyles.projectName}>{group.name}</span>
              <span style={projectSessionTreeStyles.projectCount}>
                {group.sessions.length} session{group.sessions.length !== 1 ? "s" : ""}
              </span>
              <span
                style={{
                  ...projectSessionTreeStyles.gcChip,
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
                onConfigurePolicy={onSelectProject}
                {...(onViewMemory ? { onViewMemory: () => onViewMemory(group.id!) } : {})}
              />
            )}

            {/* Session rows */}
            {!isCollapsed && (
              <>
                {fresh.map((s) => (
                  <SessionRowComponent
                    key={s.id}
                    session={s}
                    project={project}
                    isSelected={s.id === selected}
                    onSelect={onSelect}
                    {...rowActionProps}
                  />
                ))}

                {stale.length > 0 && (
                  <button
                    style={projectSessionTreeStyles.staleToggle}
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
                      project={project}
                      isSelected={s.id === selected}
                      onSelect={onSelect}
                      {...rowActionProps}
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

// -------------------- Utilities -------------------- //
/**
 * Ranks a session by GC urgency, for sorting purposes.
 * Sessions in hard GC are most urgent, then soft GC, then clean.
 * Urgency rank: hard_gc = 0, soft_gc = 1, clean = 2
 * @param s
 * @returns
 */
function urgencyRank(s: SessionRow): number {
  const state = gcState(s.current_ctx_pct ?? 0);
  return state === "hard_gc" ? 0 : state === "soft_gc" ? 1 : 2;
}

/**
 *  Given a list of sessions, returns the worst GC state among them.
 * If any session is in hard GC, returns "hard_gc". Else if any session is in soft GC, returns "soft_gc". Else returns "clean".
 * @param sessions
 * @returns
 */
function worstState(sessions: SessionRow[]): GCState {
  if (sessions.some((s) => gcState(s.current_ctx_pct ?? 0) === "hard_gc")) return "hard_gc";
  if (sessions.some((s) => gcState(s.current_ctx_pct ?? 0) === "soft_gc")) return "soft_gc";
  return "clean";
}
