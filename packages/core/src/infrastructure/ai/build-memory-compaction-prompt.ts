import { MemoryFile } from "../..";

export function buildMemoryCompactionPrompt(
  file: MemoryFile,
  slice: { text: string; start: number; end: number },
  existingContent: string,
): string {
  const modeBlock =
    file.update_mode === "merge"
      ? `EXISTING FILE CONTENT:\n${existingContent}\n\nYour task: synthesize the existing content with the new session slice below into a single updated file. Preserve all prior content that remains valid. Update or retire content that the new slice contradicts or resolves.`
      : file.update_mode === "append"
        ? "Your task: extract content from the session slice below that belongs in this file. Write only new content — do not repeat anything already in the file. Begin your output directly. It will be appended below a separator."
        : "Your task: write a fresh version of this file from the session slice below. Ignore any prior version — produce a complete, current snapshot.";

  return `You are compacting a slice of a Claude session into a structured memory file.

MEMORY FILE: ${file.filename}
PURPOSE: ${file.description}
UPDATE MODE: ${file.update_mode}

${modeBlock}

SESSION SLICE (turns ${slice.start} to ${slice.end}):
${slice.text}

Output the file content directly. No preamble. No explanation.`;
}
