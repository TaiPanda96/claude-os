import { homedir } from "os";
import { join, basename } from "path";

// Mirrors the convention Claude Code itself uses: ~/.claude/projects/<project-name>/
// The project name is the basename of the cwd, matching how ingest resolves project names.
export function memoryDir(cwd: string): string {
  const projectName = basename(cwd) || "unknown";
  return join(homedir(), ".claude", "projects", projectName, "memory");
}

// Telemetry subfolder — one JSON file per turn, keyed by a random UUID.
export function telemetryDir(cwd: string): string {
  return join(memoryDir(cwd), "telemetry");
}
