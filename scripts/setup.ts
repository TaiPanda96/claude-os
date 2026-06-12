#!/usr/bin/env bun
/**
 * First-run setup for Claude OS.
 *
 * 1. Checks prerequisites (Bun, Node, Claude Code CLI)
 * 2. Wires the Stop hook into ~/.claude/settings.json
 * 3. Offers to run the bulk ingest if ~/.claude/projects/ has transcripts
 */

import { existsSync, readFileSync, writeFileSync, readdirSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { spawnSync } from "node:child_process";

const REPO_ROOT = resolve(dirname(import.meta.path), "..");
const HOOK_SCRIPT = join(REPO_ROOT, "scripts", "hook-stop.ts");
const SETTINGS_PATH = join(process.env.HOME ?? "~", ".claude", "settings.json");
const CLAUDE_PROJECTS_PATH = join(process.env.HOME ?? "~", ".claude", "projects");

// ── Helpers ───────────────────────────────────────────────────────────────────

function ok(msg: string) {
  console.log(`  \x1b[32m✓\x1b[0m  ${msg}`);
}
function warn(msg: string) {
  console.log(`  \x1b[33m!\x1b[0m  ${msg}`);
}
function fail(msg: string) {
  console.log(`  \x1b[31m✗\x1b[0m  ${msg}`);
}
function info(msg: string) {
  console.log(`     ${msg}`);
}
function header(msg: string) {
  console.log(`\n\x1b[1m${msg}\x1b[0m`);
}

function which(cmd: string): boolean {
  return spawnSync("which", [cmd], { stdio: "ignore" }).status === 0;
}

function semverAtLeast(actual: string, required: string): boolean {
  const a = actual.replace(/[^0-9.]/g, "").split(".").map(Number);
  const r = required.split(".").map(Number);
  for (let i = 0; i < r.length; i++) {
    if ((a[i] ?? 0) > r[i]) return true;
    if ((a[i] ?? 0) < r[i]) return false;
  }
  return true;
}

// ── 1. Prerequisites ──────────────────────────────────────────────────────────

header("Checking prerequisites");

let prereqsFailed = false;

// Bun ≥ 1.1
const bunVersion = spawnSync("bun", ["--version"], { encoding: "utf-8" }).stdout?.trim() ?? "";
if (bunVersion && semverAtLeast(bunVersion, "1.1")) {
  ok(`Bun ${bunVersion}`);
} else if (bunVersion) {
  fail(`Bun ${bunVersion} — need ≥ 1.1  →  https://bun.sh`);
  prereqsFailed = true;
} else {
  fail("Bun not found  →  https://bun.sh");
  prereqsFailed = true;
}

// Node ≥ 20 (required by Electron)
const nodeVersion = spawnSync("node", ["--version"], { encoding: "utf-8" }).stdout?.trim() ?? "";
if (nodeVersion && semverAtLeast(nodeVersion.replace("v", ""), "20.0")) {
  ok(`Node.js ${nodeVersion}`);
} else if (nodeVersion) {
  fail(`Node.js ${nodeVersion} — need ≥ 20  →  https://nodejs.org`);
  prereqsFailed = true;
} else {
  fail("Node.js not found  →  https://nodejs.org");
  prereqsFailed = true;
}

// Claude Code CLI
if (which("claude")) {
  ok("Claude Code CLI found");
} else {
  fail("Claude Code CLI not found  →  https://claude.ai/code");
  prereqsFailed = true;
}

if (prereqsFailed) {
  console.log("\nFix the above before continuing.\n");
  process.exit(1);
}

// ── 2. Hook wiring ────────────────────────────────────────────────────────────

header("Wiring Claude Code stop hook");

const hookCommand = `bun run ${HOOK_SCRIPT}`;

let settings: Record<string, unknown> = {};
if (existsSync(SETTINGS_PATH)) {
  try {
    settings = JSON.parse(readFileSync(SETTINGS_PATH, "utf-8"));
  } catch {
    fail(`Could not parse ${SETTINGS_PATH} — fix JSON errors before running setup.`);
    process.exit(1);
  }
}

// Ensure hooks.Stop exists as an array
const hooks = (settings.hooks ?? {}) as Record<string, unknown>;
const stopHooks = (hooks.Stop ?? []) as Array<{ matcher?: string; hooks: Array<{ type: string; command: string }> }>;

// Idempotency check — look for any entry that already points to hook-stop.ts
const alreadyInstalled = stopHooks.some((group) =>
  group.hooks?.some((h) => h.command?.includes("hook-stop.ts"))
);

if (alreadyInstalled) {
  ok("Stop hook already installed — nothing to change");
} else {
  stopHooks.unshift({
    matcher: "",
    hooks: [{ type: "command", command: hookCommand }],
  });
  hooks.Stop = stopHooks;
  settings.hooks = hooks;
  writeFileSync(SETTINGS_PATH, JSON.stringify(settings, null, 2) + "\n", "utf-8");
  ok(`Stop hook added to ${SETTINGS_PATH}`);
  info(`Command: ${hookCommand}`);
}

// ── 3. Ingest prompt ──────────────────────────────────────────────────────────

header("Existing session data");

let transcriptCount = 0;
if (existsSync(CLAUDE_PROJECTS_PATH)) {
  try {
    for (const project of readdirSync(CLAUDE_PROJECTS_PATH, { withFileTypes: true })) {
      if (!project.isDirectory()) continue;
      const projectDir = join(CLAUDE_PROJECTS_PATH, project.name);
      for (const file of readdirSync(projectDir)) {
        if (file.endsWith(".jsonl")) transcriptCount++;
      }
    }
  } catch { /* permission issues on some machines */ }
}

if (transcriptCount > 0) {
  info(`Found ${transcriptCount} transcript(s) in ~/.claude/projects/`);
  info("Run \x1b[1mbun run ingest\x1b[0m to populate the database with existing sessions.");
} else {
  info("No existing transcripts found — the database will populate as you use Claude Code.");
}

// ── Done ──────────────────────────────────────────────────────────────────────

console.log(`
\x1b[1mSetup complete.\x1b[0m

Next steps:
  1. Run \x1b[1mbun run ingest\x1b[0m  (optional — imports existing sessions)
  2. Run \x1b[1mbun run dev\x1b[0m     (starts the activity monitor)
  3. End a Claude Code session — the hook fires automatically and the DB updates
`);
