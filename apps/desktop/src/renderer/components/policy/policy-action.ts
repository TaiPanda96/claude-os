import { ActionOverflowType } from "../action-overflow.js";
import { Project } from "../../types.js";

/**
 * The project-scoped "Configure/Edit Policy" overflow item, shared by every
 * session/project ActionOverflow (table rows, session rows, the policy banner)
 * so the label and enablement rules live in one home and can't drift apart.
 *
 * Policy is attached to a project, so a session with no project (ungrouped)
 * yields a disabled item rather than a dead link.
 */
export function policyOverflowAction(
  project: Project | null,
  onConfigurePolicy: (projectId: string) => void,
): ActionOverflowType {
  const hasPolicy = project?.has_policy === 1;
  const action: ActionOverflowType = {
    key: "policy",
    glyph: "◆",
    label: hasPolicy ? "Edit Policy" : "Configure Policy",
    description: project
      ? hasPolicy
        ? "Adjust compaction triggers & model"
        : "Set compaction triggers for this project"
      : "No project — nothing to attach a policy to",
    disabled: !project,
  };
  // Only wire onSelect when there's a project; exactOptionalPropertyTypes forbids
  // assigning `undefined`, and the disabled item never fires it anyway.
  if (project) action.onSelect = () => onConfigurePolicy(project.id);
  return action;
}
