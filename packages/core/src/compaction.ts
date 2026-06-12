import { existsSync, mkdirSync, readFileSync, writeFileSync, appendFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { v4 as uuidv4 } from "uuid";
import Anthropic from "@anthropic-ai/sdk";
import type { Database } from "./types.js";
import type { CompactionPolicy, CompactionEvent, CompactionFileResult, MemoryFile } from "./types.js";
import { TriggerTypeEnum, type Turn } from "./types.js";
import { insertCompactionEvent, updateCompactionEvent, getLastCompactionEvent, getSessionTurns } from "./db.js";

const COMPACTION_MODEL = "claude-haiku-4-5-20251001";
const MERGE_MODEL      = "claude-sonnet-4-6";
const MAX_TOKENS_DEFAULT = 8000;
const MERGE_EXISTING_CAP = 4000;

// Memory files live at ~/.claude/projects/{urlencoded-cwd}/claude-os/memory/
function memoryDir(cwd: string): string {
  const encoded = encodeURIComponent(cwd).replace(/%2F/g, "-");
  return join(homedir(), ".claude", "projects", encoded, "claude-os", "memory");
}

function ensureDir(dir: string): void {
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

function readExisting(filePath: string, capChars: number): string {
  if (!existsSync(filePath)) return "";
  const content = readFileSync(filePath, "utf-8");
  // Rough token estimate: 4 chars per token
  return content.slice(0, capChars * 4);
}

function assembleSlice(turns: Turn[], fromTurnIndex: number, maxTokens: number): { text: string; start: number; end: number } {
  const slice = turns.filter((t) => t.turnIndex >= fromTurnIndex);
  if (slice.length === 0) return { text: "", start: fromTurnIndex, end: fromTurnIndex };

  // Budget: 4 chars per token estimate, newest turns first to preserve recency
  const budget = maxTokens * 4;
  const parts: string[] = [];
  let used = 0;
  for (const t of [...slice].reverse()) {
    const line = `[Turn ${t.turnIndex}] output_tokens=${t.outputTokens} ctx=${(t.ctxPct * 100).toFixed(1)}%`;
    if (used + line.length > budget) break;
    parts.unshift(line);
    used += line.length;
  }

  return {
    text: parts.join("\n"),
    start: slice[0]!.turnIndex,
    end: slice[slice.length - 1]!.turnIndex,
  };
}

function buildPrompt(file: MemoryFile, slice: { text: string; start: number; end: number }, existingContent: string): string {
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

async function writeMemoryFile(
  dir: string,
  file: MemoryFile,
  content: string,
): Promise<CompactionFileResult> {
  ensureDir(dir);
  const filePath = join(dir, file.filename);
  const bytes = Buffer.byteLength(content, "utf-8");

  if (file.update_mode === "append") {
    const separator = `\n---\n<!-- compacted ${new Date().toISOString()} -->\n`;
    appendFileSync(filePath, separator + content, "utf-8");
  } else {
    writeFileSync(filePath, content, "utf-8");
  }

  return {
    filename: file.filename,
    update_mode: file.update_mode,
    bytes_written: bytes,
    preview: content.slice(0, 200),
  };
}

export async function runCompaction(
  db: Database,
  sessionId: string,
  policy: CompactionPolicy,
  triggeredBy: TriggerTypeEnum,
  triggerDetail: string,
  tokensAtTrigger: number,
  cwd: string,
): Promise<CompactionEvent> {
  const client = new Anthropic();
  const now = new Date().toISOString();
  const eventId = uuidv4();

  const event: CompactionEvent = {
    id: eventId,
    session_id: sessionId,
    policy_id: policy.id,
    triggered_by: triggeredBy,
    trigger_detail: triggerDetail,
    files_written: [],
    tokens_at_trigger: tokensAtTrigger,
    status: "running",
    started_at: now,
    completed_at: null,
    error: null,
  };
  insertCompactionEvent(db, event);

  try {
    const turns = getSessionTurns(db, sessionId);
    const lastEvent = getLastCompactionEvent(db, sessionId);
    const fromTurnIndex = lastEvent
      ? turns.findIndex((t) => t.createdAt > new Date(lastEvent.completed_at!).getTime())
      : 0;

    const dir = memoryDir(cwd);
    const filesWritten: CompactionFileResult[] = [];

    for (const file of policy.memory_schema) {
      const maxTokens = file.max_tokens ?? MAX_TOKENS_DEFAULT;
      const slice = assembleSlice(turns, Math.max(0, fromTurnIndex), maxTokens);
      if (!slice.text) continue;

      const filePath = join(dir, file.filename);
      const existingContent = file.update_mode === "merge"
        ? readExisting(filePath, MERGE_EXISTING_CAP)
        : "";

      const prompt = buildPrompt(file, slice, existingContent);
      const model = file.update_mode === "merge" ? MERGE_MODEL : COMPACTION_MODEL;

      const response = await client.messages.create({
        model,
        max_tokens: 2048,
        messages: [{ role: "user", content: prompt }],
      });

      const outputText = response.content
        .filter((b) => b.type === "text")
        .map((b) => (b as { text: string }).text)
        .join("\n");

      const result = await writeMemoryFile(dir, file, outputText);
      filesWritten.push(result);
    }

    const completed_at = new Date().toISOString();
    updateCompactionEvent(db, eventId, { status: "completed", files_written: filesWritten, completed_at });
    return { ...event, status: "completed", files_written: filesWritten, completed_at };
  } catch (err) {
    const completed_at = new Date().toISOString();
    const error = err instanceof Error ? err.message : String(err);
    updateCompactionEvent(db, eventId, { status: "failed", completed_at, error });
    return { ...event, status: "failed", completed_at, error };
  }
}
