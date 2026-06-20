import { gc, tokens } from "../../theme";
import { SessionRow, Project, gcState } from "../../types";
import { ActionOverflowType, ActionOverflow } from "../action-overflow";
import { GC_LABEL } from "../garbage-compaction-labels";
import { policyOverflowAction } from "../policy/policy-action";
import { projectSessionTreeStyles } from "../project/project-session-tree-styles-config";

// ── Session row ───────────────────────────────────────────────────────────────
export function SessionRowComponent({
  session: s,
  project = null,
  isSelected,
  onSelect,
  onCompact,
  onCompactFork,
  onConfigurePolicy,
  showProject = false,
  dimmed = false,
}: {
  session: SessionRow;
  project?: Project | null;
  isSelected: boolean;
  onSelect: (id: string) => void;
  onCompact?: (id: string) => void;
  onCompactFork?: (id: string) => void;
  onConfigurePolicy?: (projectId: string) => void;
  showProject?: boolean;
  dimmed?: boolean;
}) {
  const pct = s.current_ctx_pct ?? 0;
  const state = gcState(pct);
  const gcColors = gc[state];
  const hasTurns = s.turn_count > 0;

  // Same overflow set as the table view, plus the project-scoped policy item, so
  // policy is reachable from a session row in every view.
  const actions: ActionOverflowType[] = [
    {
      key: "compact",
      glyph: "⊟",
      label: "Compact",
      description: "Prune session destructively & continue",
      danger: true,
      disabled: !hasTurns,
      ...(onCompact ? { onSelect: () => onCompact(s.id) } : {}),
    },
    {
      key: "fork",
      glyph: "⑂",
      label: "Fork",
      description: "Compact & update memory.md",
      disabled: !hasTurns,
      ...(onCompactFork ? { onSelect: () => onCompactFork(s.id) } : {}),
    },
    ...(onConfigurePolicy ? [policyOverflowAction(project, onConfigurePolicy)] : []),
  ];

  return (
    <div
      style={{
        ...projectSessionTreeStyles.sessionRow,
        ...(isSelected ? projectSessionTreeStyles.sessionRowSelected : {}),
        opacity: dimmed ? 0.45 : 1,
      }}
      onClick={() => onSelect(s.id)}
    >
      {/* Indent + dot */}
      <div style={projectSessionTreeStyles.sessionLeft}>
        <span style={projectSessionTreeStyles.indent} />
        <span style={{ ...projectSessionTreeStyles.dot, background: gcColors.dot }} />
        <span
          style={{
            ...projectSessionTreeStyles.sessionName,
            color: state === "hard_gc" ? gcColors.text : tokens.highlight,
          }}
        >
          {s.name ?? "unnamed"}
        </span>
        {showProject && (
          <span style={projectSessionTreeStyles.projectTag}>{s.project_name ?? "Ungrouped"}</span>
        )}
        <span style={projectSessionTreeStyles.sessionId}>{s.id.slice(0, 6)}</span>
        {s.forked_from && (
          <span
            style={projectSessionTreeStyles.forkBadge}
            title={`Forked from ${s.forked_from.slice(0, 8)}`}
          >
            ⑂
          </span>
        )}
      </div>

      {/* Context bar */}
      <div style={projectSessionTreeStyles.barWrap}>
        <div style={projectSessionTreeStyles.barTrack}>
          <div
            style={{
              ...projectSessionTreeStyles.barFill,
              width: `${Math.min(pct * 100, 100)}%`,
              background: gcColors.dot,
            }}
          />
          <div
            style={{
              ...projectSessionTreeStyles.barZone,
              left: "60%",
              background: `${gc.soft_gc.dot}22`,
            }}
          />
          <div
            style={{
              ...projectSessionTreeStyles.barZone,
              left: "80%",
              width: "20%",
              background: `${gc.hard_gc.dot}22`,
            }}
          />
        </div>
      </div>

      {/* ctx % */}
      <span style={{ ...projectSessionTreeStyles.pct, color: gcColors.text }}>
        {(Math.min(pct, 1) * 100).toFixed(0)}%
      </span>

      {/* GC chip */}
      <span
        style={{
          ...projectSessionTreeStyles.gcChip,
          color: gcColors.text,
          background: gcColors.bg,
          border: `0.5px solid ${gcColors.border}`,
        }}
      >
        {GC_LABEL[state]}
      </span>

      {/* Last active */}
      <span style={projectSessionTreeStyles.time}>{relativeTime(s.last_active_at)}</span>

      {/* Row actions — Compact / Fork / Configure Policy */}
      <div style={projectSessionTreeStyles.rowActions}>
        <ActionOverflow actions={actions} ariaLabel={`Actions for ${s.name ?? s.id.slice(0, 6)}`} />
      </div>
    </div>
  );
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
