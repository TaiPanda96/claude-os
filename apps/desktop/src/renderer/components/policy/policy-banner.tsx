// ── Policy banner ───────────────────────────────────────────────────────────────
// Project-scoped strip: surfaces whether a compaction policy is configured and
// active, and hosts the project-level actions. Deliberately styled apart from

import { tokens, gc } from "../../theme";
import { Project } from "../../types";
import { ActionOverflowType, ActionOverflow } from "../action-overflow";
import { projectSessionTreeStyles } from "../project/project-session-tree-styles-config";
import { policyOverflowAction } from "./policy-action";

// session rows so the project/session topology reads clearly.
export function PolicyBanner({
  project,
  onConfigurePolicy,
  onViewMemory,
}: {
  project: Project;
  onConfigurePolicy: (projectId: string) => void;
  onViewMemory?: () => void;
}) {
  const hasPolicy = project.has_policy === 1;
  const isActive = project.policy_active === 1;

  const status = !hasPolicy
    ? { dot: tokens.muted, text: tokens.muted, label: "No policy configured" }
    : isActive
      ? {
          dot: gc.clean.dot,
          text: gc.clean.text,
          label: `Policy active${project.policy_name ? ` · ${project.policy_name}` : ""}`,
        }
      : {
          dot: gc.soft_gc.dot,
          text: gc.soft_gc.text,
          label: `Policy paused${project.policy_name ? ` · ${project.policy_name}` : ""}`,
        };

  // Per-project overflow — same kebab pattern as session rows, so project-level
  // actions live in one consistent place. Policy stays a prominent CTA too, since
  // configuring it is the headline action we deliberately keep discoverable.
  const actions: ActionOverflowType[] = [
    policyOverflowAction(project, onConfigurePolicy),
    ...(onViewMemory
      ? [
          {
            key: "memory",
            glyph: "◈",
            label: "Peer into Memory",
            description: "Inspect memory artifacts & compaction history",
            onSelect: onViewMemory,
          } satisfies ActionOverflowType,
        ]
      : []),
    {
      key: "optimize",
      glyph: "⊟",
      label: "Optimize Context Window",
      description: "Automatically compact the active window",
      disabled: true,
      badge: "Soon",
    },
  ];

  return (
    <div style={projectSessionTreeStyles.policyBanner}>
      <span style={projectSessionTreeStyles.indent} />
      <span style={{ ...projectSessionTreeStyles.policyStatusDot, background: status.dot }} />
      <span style={{ ...projectSessionTreeStyles.policyStatusText, color: status.text }}>
        {status.label}
      </span>

      <div style={projectSessionTreeStyles.policyActions}>
        <button
          style={projectSessionTreeStyles.editPolicyBtn}
          onClick={() => onConfigurePolicy(project.id)}
        >
          {hasPolicy ? "Edit Policy" : "Configure Policy"}
        </button>
        <ActionOverflow actions={actions} ariaLabel="Project actions" />
      </div>
    </div>
  );
}
