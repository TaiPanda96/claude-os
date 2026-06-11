import { readdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

export const DEFAULT_PROJECTS_DIR = join(homedir(), ".claude", "projects");

/**
 * Resolves the JSONL transcript path for a given session.
 *
 * Returns the transcriptPath directly if it exists.
 * Otherwise scans the projects directory for a file whose name contains sessionId.
 */
export function findJsonlForSession(
  sessionId: string,
  transcriptPath?: string,
  projectsDir = DEFAULT_PROJECTS_DIR,
): string | null {
  if (transcriptPath && existsSync(transcriptPath)) return transcriptPath;

  for (const dir of readdirSync(projectsDir)) {
    const dirPath = join(projectsDir, dir);
    try {
      for (const file of readdirSync(dirPath)) {
        if (file.endsWith(".jsonl") && file.includes(sessionId)) {
          return join(dirPath, file);
        }
      }
    } catch {
      continue;
    }
  }

  return null;
}
