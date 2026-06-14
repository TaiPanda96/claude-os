import { homedir } from "os";
import { join } from "path";

/**
 *
 * @param cwd - change working directory (usually the project root) used to scope the memory files.
 * This is encoded and becomes part of the path, so different cwd will lead to different memory dirs.
 * @returns the path to the memory directory for the given cwd. Memory files live at ~/.claude/projects/{urlencoded-cwd}/claude-os/memory/
 */
export function memoryDir(cwd: string): string {
  const encoded = encodeURIComponent(cwd).replace(/%2F/g, "-");
  return join(homedir(), ".claude", "projects", encoded, "claude-os", "memory");
}
