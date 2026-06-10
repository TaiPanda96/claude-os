#!/usr/bin/env bun
/**
 * Phase 0 harness — drives a multi-turn conversation through the instrumented
 * wrapper and prints live turn-by-turn stats to stdout.
 *
 * Usage:
 *   bun run src/harness.ts --name "my-session" --turns 20
 *   bun run src/harness.ts --name "my-session" --turns 20 --topic "refactor a React codebase"
 *
 * The harness simulates a realistic long-running coding/research session by
 * building a cumulative conversation thread. Each prompt builds on the last,
 * forcing context to accumulate naturally.
 */

import { parseArgs } from "util";
import { createInstrumentedClient } from "./wrapper.js";

const { values } = parseArgs({
  args: Bun.argv.slice(2),
  options: {
    name:  { type: "string", default: `session-${Date.now()}` },
    turns: { type: "string", default: "15" },
    topic: { type: "string", default: "designing a TypeScript monorepo with shared packages" },
    model: { type: "string", default: "claude-haiku-4-5-20251001" },
  },
  strict: true,
});

const TURNS = parseInt(values.turns ?? "15", 10);
const MODEL = values.model ?? "claude-haiku-4-5-20251001";
const TOPIC = values.topic ?? "";
const SESSION_NAME = values.name ?? "";

// Prompts that build on each other to force context accumulation
const PROMPT_TEMPLATES = [
  `I'm ${TOPIC}. Give me a comprehensive overview of the key challenges and decisions involved.`,
  "What are the most important trade-offs in the approach you described? Go into detail on each.",
  "Let's focus on the first trade-off you mentioned. What would a concrete implementation look like?",
  "What edge cases or failure modes should I be aware of with that approach?",
  "How would you handle testing for this? Write out a testing strategy.",
  "What does the folder structure look like? Show me a detailed file tree with explanations.",
  "Now let's tackle the second trade-off. How would you resolve it differently?",
  "Walk me through the dependency management concerns in detail.",
  "Write the core configuration files needed for this setup.",
  "What CI/CD considerations are specific to this architecture?",
  "How would you handle versioning and releases across packages?",
  "What tooling would you add to improve developer experience?",
  "Let's revisit the implementation from earlier — what would you change now that we've discussed more?",
  "Summarise all the decisions we've made and why we made them.",
  "What would you recommend as the very next step someone should take?",
  "Are there any contradictions or inconsistencies in the approach we've built up?",
  "Write a README section that documents the architecture decisions.",
  "What's the biggest risk in this plan and how would you mitigate it?",
  "If you were starting over with this, what would you do differently?",
  "Final question: is this the right architecture for this problem, or should we reconsider the fundamentals?",
];

function gcLabel(ctxPct: number): string {
  if (ctxPct >= 0.80) return "\x1b[31mHard GC\x1b[0m";
  if (ctxPct >= 0.60) return "\x1b[33mSoft GC\x1b[0m";
  return "\x1b[32mClean\x1b[0m  ";
}

function bar(pct: number, width = 30): string {
  const filled = Math.round(pct * width);
  const empty = width - filled;
  const color = pct >= 0.80 ? "\x1b[31m" : pct >= 0.60 ? "\x1b[33m" : "\x1b[32m";
  return `${color}${"█".repeat(filled)}\x1b[90m${"░".repeat(empty)}\x1b[0m`;
}

const messages: Array<{ role: "user" | "assistant"; content: string }> = [];

const client = createInstrumentedClient(undefined, {
  sessionName: SESSION_NAME,
  onGCStateChange: (state, ctxPct) => {
    const label = state === "hard_gc" ? "\x1b[31m⚠ HARD GC\x1b[0m" : "\x1b[33m⚡ SOFT GC\x1b[0m";
    console.log(`\n  ${label} — context at ${(ctxPct * 100).toFixed(1)}%\n`);
  },
});

console.log(`\n\x1b[1mClaude OS — Phase 0 Harness\x1b[0m`);
console.log(`Session:  ${SESSION_NAME}`);
console.log(`Model:    ${MODEL}`);
console.log(`Turns:    ${TURNS}`);
console.log(`Topic:    ${TOPIC}`);
console.log(`DB:       ${process.env.CLAUDE_OS_DB_PATH ?? "claude-os.sqlite"}\n`);
console.log("─".repeat(80));
console.log(
  `${"Turn".padEnd(5)} ${"In".padStart(7)} ${"Out".padStart(7)} ${"Cumul".padStart(9)} ` +
  `${"Ctx%".padStart(6)} ${"ms".padStart(6)} ${"SC".padStart(3)} ${"Rep".padStart(5)}  ${"State"}`
);
console.log("─".repeat(80));

for (let i = 0; i < TURNS; i++) {
  const prompt = PROMPT_TEMPLATES[i % PROMPT_TEMPLATES.length] ?? `Continue on turn ${i + 1}.`;
  messages.push({ role: "user", content: prompt });

  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 1024,
    messages,
  });

  const assistantText = response.content
    .filter((b) => b.type === "text")
    .map((b) => (b as { type: "text"; text: string }).text)
    .join("\n");

  messages.push({ role: "assistant", content: assistantText });

  const health = client.getHealth();
  const { input_tokens, output_tokens } = response.usage;

  // Pull quality signals from the last row written to DB — simpler than re-deriving
  const { Database } = await import("bun:sqlite");
  const dbPath = process.env.CLAUDE_OS_DB_PATH ?? "claude-os.sqlite";
  const db = new Database(dbPath, { readonly: true });
  const row = db.prepare(
    `SELECT self_correction_count, repetition_score FROM turns WHERE session_id = $sid ORDER BY turn_index DESC LIMIT 1`
  ).get({ $sid: client.sessionId }) as { self_correction_count: number; repetition_score: number } | undefined;
  db.close();

  const sc = row?.self_correction_count ?? 0;
  const rep = row?.repetition_score ?? 0;
  const cumul = health.ctxPct * (200_000);

  console.log(
    `${String(i + 1).padEnd(5)} ` +
    `${String(input_tokens).padStart(7)} ` +
    `${String(output_tokens).padStart(7)} ` +
    `${String(Math.round(cumul)).padStart(9)} ` +
    `${(health.ctxPct * 100).toFixed(1).padStart(5)}% ` +
    `${String(response.usage.input_tokens > 0 ? "—" : "—").padStart(6)} ` +
    `${String(sc).padStart(3)} ` +
    `${rep.toFixed(2).padStart(5)}  ` +
    `${gcLabel(health.ctxPct)}`
  );
}

console.log("─".repeat(80));
const health = client.getHealth();
console.log(`\n\x1b[1mSession complete\x1b[0m`);
console.log(`Context:  ${bar(health.ctxPct)} ${(health.ctxPct * 100).toFixed(1)}%`);
console.log(`Turns:    ${health.turnCount}`);
console.log(`GC state: ${gcLabel(health.ctxPct)}`);
console.log(`\nRun the notebook to plot the efficiency curve:\n  cd analysis && jupyter notebook efficiency_curve.ipynb\n`);

client.close();
