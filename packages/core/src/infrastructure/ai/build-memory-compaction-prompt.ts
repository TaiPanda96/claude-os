import { MemoryFile, CompactionPolicy, DecayScope, TriggerTypeEnum } from "../../types.js";
import { memoryUpdateEnumType } from "./memory-schema.js";

/**
 * The retention horizon of a memory file, expressed to the summarizer as a
 * durability bar: what content qualifies, at what abstraction level, and how
 * conservative to be when retiring existing content on merge. (This is decay's
 * *prompt* half only — actual eviction/lifecycle is a separate mechanism.)
 */
const DECAY_GUIDANCE: Record<DecayScope, string> = {
  session: `DECAY: session — ephemeral working memory for the current session only. Capture concrete, in-flight detail (current task state, decisions in progress); do not generalize. When merging, freely drop state that is no longer current.`,
  project: `DECAY: project — persists across sessions for the life of this project. Capture durable project knowledge (architecture, conventions, resolved decisions); omit session-only noise. When merging, retire content only once it is superseded or resolved.`,
  permanent: `DECAY: permanent — never decays. Record only facts that remain true indefinitely (identity, standing preferences, invariants); strip session- and project-specific specifics and generalize. When merging, retire existing content only if it is now factually wrong, never merely because it is old.`,
};

/**
 * Builds a prompt instructing the LLM how to update a memory file based on a slice of session turns, according to the file's update mode and existing content.
 *
 * The prompt is framed with policy-level signal so the summarizer sees not just
 * the leaf file it's writing, but what the whole memory set is for (the policy
 * objective), why this run fired (the trigger), which sibling files exist, and
 * the file's decay scope (the durability bar for what it should retain) — the
 * inputs it needs to prioritize and route content correctly. That derivation
 * lives here rather than at the call site because it is prompt-shaping logic,
 * not orchestration.
 *
 * @param file The memory file being updated, including its filename, description, update mode, and optionally format and max tokens.
 * @param slice A slice of session turns to be compacted into the memory file, including the text content and the start and end turn indices.
 * @param existingContent The existing content of the memory file, if any, used for "append" and "merge" update modes to guide the LLM in determining what new content to add or how to reconcile with prior content.
 * @param policy The owning policy — supplies the objective and the sibling files that frame this file within the wider memory set.
 * @param trigger Why this compaction fired; the strongest signal of what to prioritize when deciding what to keep.
 * @returns A string containing the prompt to be sent to the LLM for memory compaction.
 */
export function buildMemoryCompactionPrompt(
  file: MemoryFile,
  slice: { text: string; start: number; end: number },
  existingContent: string,
  policy: CompactionPolicy,
  trigger: { type: TriggerTypeEnum; detail: string },
): string {
  const updateMode = memoryUpdateEnumType.safeParse(file.update_mode);
  if (!updateMode.success) {
    throw new Error(`Memory update enum error: ${updateMode.error.message}`);
  }

  const formatHint = file.format
    ? `FORMAT: ${file.format} — preserve this structure across compactions.\n`
    : "";

  const decayBlock = `${DECAY_GUIDANCE[file.decay]}\n`;

  const objectiveBlock = policy.objective ? `POLICY OBJECTIVE: ${policy.objective}\n` : "";

  const triggerBlock = `TRIGGERED BY: ${trigger.type}${
    trigger.detail ? ` — ${trigger.detail}` : ""
  }\nPrioritize content relevant to this trigger when deciding what to keep.\n`;

  // Expose the other files in this policy (filenames + purpose, never content) so
  // the summarizer can route content to its rightful file instead of duplicating it.
  const siblings = policy.memory_schema.filter((s) => s.filename !== file.filename);
  const siblingsBlock = siblings.length
    ? `OTHER FILES IN THIS POLICY (route their content there — do not duplicate it here):\n${siblings
        .map((s) => `- ${s.filename}: ${s.description}`)
        .join("\n")}\n`
    : "";

  let taskBlock: string;
  switch (updateMode.data) {
    case "append":
      taskBlock = existingContent
        ? `EXISTING FILE CONTENT (do not repeat anything already captured here):\n${existingContent}\n\nYour task: extract only net-new content from the session slice — decisions, facts, or events not already recorded above.`
        : `Your task: extract content from the session slice that belongs in this file based on its purpose.`;
      break;

    case "merge":
      taskBlock = existingContent
        ? `EXISTING FILE CONTENT:\n${existingContent}\n\nYour task: synthesize the existing content with the new session slice into a single updated file. Preserve all prior content that remains valid. Remove (do not preserve) any content the new slice contradicts or resolves.`
        : `Your task: synthesize the new session slice into a structured file based on its purpose.`;
      break;

    case "overwrite":
      // existingContent intentionally not used — mode produces a clean snapshot
      taskBlock = `Your task: write a complete, current snapshot of this file from the session slice. Do not preserve structure or content from any prior version.`;
      break;

    default:
      throw new Error(`Unsupported memory update mode: ${file.update_mode}`);
  }

  return `You are compacting a slice of a Claude session into a structured memory file.

${objectiveBlock}MEMORY FILE: ${file.filename}
PURPOSE: ${file.description}
UPDATE MODE: ${file.update_mode}
${formatHint}${decayBlock}${triggerBlock}${siblingsBlock}
${taskBlock}

SESSION SLICE (turns ${slice.start}–${slice.end}, user+assistant pairs):
${slice.text}

Output the file content directly. No preamble. No explanation.`;
}
