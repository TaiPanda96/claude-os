import { homedir } from "os";
import { join } from "path";

// Mirrors the convention Claude Code itself uses: ~/.claude/projects/<slug>/memory/
// Claude Code slugifies the full absolute path by replacing every "/" with "-",
// so /Users/foo/bar/myproject → -Users-foo-bar-myproject. basename() produces a
// different directory and would cause the monitor to read/write memory that Claude
// Code never touches.
export function memoryDir(cwd: string): string {
  const slug = cwd.replace(/\//g, "-") || "unknown";
  return join(homedir(), ".claude", "projects", slug, "memory");
}

// Telemetry subfolder — one JSON file per turn, keyed by a random UUID.
export function telemetryDir(cwd: string): string {
  return join(memoryDir(cwd), "telemetry");
}
