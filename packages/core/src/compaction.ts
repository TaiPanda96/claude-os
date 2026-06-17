import { join } from "node:path";
import { readFileSync, existsSync } from "node:fs";
import { v4 as uuidv4 } from "uuid";
import type { Database } from "./types.js";
import type {
  CompactionPolicy,
  CompactionEvent,
  CompactionFileResult,
  AssistantRecord,
  UserRecord,
} from "./types.js";
import { TriggerTypeEnum, type Turn } from "./types.js";
import {
  insertCompactionEvent,
  updateCompactionEvent,
  getLastCompactionEvent,
  getSessionTurns,
} from "./db.js";
import type { SummarizerPort } from "./domain/llm-ports.js";
import type { CompactionEventSink } from "./domain/compaction-lifecycle-event.js";
import { noopEventSink } from "./domain/compaction-lifecycle-event.js";
import { llmPortFactory } from "./infrastructure/anthropic-llm.js";
import { memoryDir } from "./utils/memory-dir.js";
import { ensureDir } from "./utils/ensure-dir-exists.js";
import { readDir } from "./utils/read-dir.js";
import { writeMemoryFileToDir } from "./utils/write-memory-file-to-dir.js";
import { buildMemoryCompactionPrompt } from "./infrastructure/ai/build-memory-compaction-prompt.js";
import { findJsonlForSession } from "./ingest/find-jsonl-for-session.js";

const MAX_TOKENS_DEFAULT = 8000;
const MERGE_EXISTING_CAP = 4000;
// Output cap for each memory-file generation, independent of the input slice budget.
const OUTPUT_MAX_TOKENS = 2048;
const TOKEN_SLICE_BUDGET_MULTIPLIER = 4; // Rough chars per token estimate

/**
 * Base Compaction Workflow:
 * 1. Create a CompactionEvent with status "running" and record the trigger details.
 * 2. For each MemoryFile in the policy:
 *    a. Assemble a slice of recent turns since the last compaction, up to the max token limit.
 *    b. Build a prompt for the summarizer based on the update mode (merge/append/fresh).
 *    c. Call the summarizer port to generate the new file content.
 *    d. Write the content to disk according to the update mode, and record the result.
 * 3. If all files are processed successfully, update the CompactionEvent status to "completed" and save file results.
 * 4. If any error occurs, catch it, update the CompactionEvent status to "failed", and record the error message.
 *
 * This workflow ensures that we have a complete audit trail of compaction events, including what triggered them, what files were written, and any errors that occurred.
 * The use of the summarizer port abstracts away the LLM details, allowing for flexibility in how the summarization is performed.
 */
export async function compaction(
  db: Database,
  sessionId: string,
  policy: CompactionPolicy,
  triggeredBy: TriggerTypeEnum,
  triggerDetail: string,
  tokensAtTrigger: number,
  cwd: string,
  summarizer: SummarizerPort = llmPortFactory().summarizer,
  sink: CompactionEventSink = noopEventSink,
  // Defaults to a fresh id for the manual/standalone path; the trigger evaluator passes
  // the id it already emitted `compaction.triggered` with, so the whole stream correlates.
  eventId: string = uuidv4(),
): Promise<CompactionEvent> {
  const now = new Date().toISOString();

  const event: CompactionEvent = {
    id: eventId,
    session_id: sessionId,
    policy_id: policy.id,
    triggered_by: triggeredBy,
    trigger_detail: triggerDetail,
    files_written: [],
    tokens_at_trigger: tokensAtTrigger,
    output_size_tokens: 0,
    status: "running",
    started_at: now,
    completed_at: null,
    error: null,
  };

  insertCompactionEvent(db, event);
  try {
    sink.emit({
      type: "compaction.started",
      eventId,
      sessionId,
      policyId: policy.id,
      triggeredBy,
      tokensAtTrigger,
      at: now,
    });
  } catch {
    /* best-effort: event sinks must not break compaction */
  }
  try {
    const turns = getSessionTurns(db, sessionId);
    const lastEvent = getLastCompactionEvent(db, sessionId);
    const fromTurnIndex = lastEvent
      ? turns.findIndex((t) => t.createdAt > new Date(lastEvent.completed_at!).getTime())
      : 0;

    const dir = memoryDir(cwd);
    ensureDir(dir);
    const filesWritten: CompactionFileResult[] = [];

    for (const file of policy.memory_schema) {
      const maxTokens = file.max_tokens ?? MAX_TOKENS_DEFAULT;
      const slice = assembleSliceToCompact(turns, sessionId, Math.max(0, fromTurnIndex), maxTokens);
      if (!slice.text) continue;
      const filePath = join(dir, file.filename);
      const existingContent =
        file.update_mode === "merge" ? readDir(filePath, MERGE_EXISTING_CAP) : "";

      const prompt = buildMemoryCompactionPrompt(file, slice, existingContent);

      const outputText = await summarizer.summarize(prompt, {
        merge: file.update_mode === "merge",
        maxTokens: OUTPUT_MAX_TOKENS,
      });

      const result = await writeMemoryFileToDir(dir, file, outputText);
      filesWritten.push(result);
      try {
        sink.emit({
          type: "compaction.file_written",
          eventId,
          sessionId,
          file: result,
          at: new Date().toISOString(),
        });
      } catch {
        /* best-effort: event sinks must not break compaction */
      }
    }

    const completed_at = new Date().toISOString();
    const outputSizeTokens = filesWritten.reduce(
      (sum, f) => sum + Math.round(f.bytes_written / 4),
      0,
    );
    updateCompactionEvent(db, eventId, {
      status: "completed",
      files_written: filesWritten,
      output_size_tokens: outputSizeTokens,
      completed_at,
    });
    sink.emit({
      type: "compaction.completed",
      eventId,
      sessionId,
      filesWritten,
      at: completed_at,
    });
    return {
      ...event,
      status: "completed",
      files_written: filesWritten,
      output_size_tokens: outputSizeTokens,
      completed_at,
    };
  } catch (err) {
    const completed_at = new Date().toISOString();
    const error = err instanceof Error ? err.message : String(err);
    updateCompactionEvent(db, eventId, {
      status: "failed",
      completed_at,
      error,
    });
    sink.emit({
      type: "compaction.failed",
      eventId,
      sessionId,
      error,
      at: completed_at,
    });
    return { ...event, status: "failed", completed_at, error };
  }
}

/**
 * Assembles a conversation slice from the session's JSONL file.
 *
 * Reads the actual user/assistant messages for the session, filters to turns
 * at or after `fromTurnIndex`, and fits them within the token budget.
 * Falls back to turn-metrics text if no JSONL is found (e.g. policy-driven
 * compaction triggered before the first JSONL flush).
 */
function assembleSliceToCompact(
  turns: Turn[],
  sessionId: string,
  fromTurnIndex: number,
  maxTokens: number,
): { text: string; start: number; end: number } {
  const slice = turns.filter((t) => t.turnIndex >= fromTurnIndex);
  if (slice.length === 0) return { text: "", start: fromTurnIndex, end: fromTurnIndex };

  const startIdx = slice[0]!.turnIndex;
  const endIdx = slice[slice.length - 1]!.turnIndex;
  const budget = maxTokens * TOKEN_SLICE_BUDGET_MULTIPLIER;

  const jsonlPath = findJsonlForSession(sessionId);
  if (jsonlPath && existsSync(jsonlPath)) {
    const lines = readFileSync(jsonlPath, "utf-8").split("\n").filter(Boolean);
    const records = lines.flatMap((l) => {
      try {
        return [JSON.parse(l) as AssistantRecord | UserRecord];
      } catch {
        return [];
      }
    });

    // Build a uuid→user-text index, then pair with assistant records in order
    const userByUuid = new Map<string, string>();
    for (const r of records) {
      if (r.type !== "user") continue;
      const u = r as UserRecord;
      const text =
        typeof u.message.content === "string"
          ? u.message.content
          : (u.message.content as Array<{ type: string; text?: string }>)
              .filter((b) => b.type === "text")
              .map((b) => b.text ?? "")
              .join("\n");
      userByUuid.set(u.uuid, text);
    }

    // Filter assistant records to this session, sort by timestamp, slice to fromTurnIndex
    const assistants = (
      records.filter(
        (r) => r.type === "assistant" && (r as AssistantRecord).sessionId === sessionId,
      ) as AssistantRecord[]
    ).sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());

    const relevant = assistants.slice(fromTurnIndex);
    const parts: string[] = [];
    let used = 0;

    for (const a of relevant) {
      const assistantText = a.message.content
        .filter((b) => b.type === "text")
        .map((b) => b.text ?? "")
        .join("\n")
        .trim();
      const userText = a.parentUuid ? (userByUuid.get(a.parentUuid) ?? "") : "";

      const block = [
        userText ? `[User]\n${userText}` : null,
        assistantText ? `[Assistant]\n${assistantText}` : null,
      ]
        .filter(Boolean)
        .join("\n\n");

      if (!block) continue;
      if (used + block.length > budget) break;
      parts.push(block);
      used += block.length;
    }

    if (parts.length > 0) {
      return { text: parts.join("\n\n---\n\n"), start: startIdx, end: endIdx };
    }
  }

  // Fallback: turn metrics only (no JSONL available)
  const parts: string[] = [];
  let used = 0;
  for (const t of [...slice].reverse()) {
    const line = `[Turn ${t.turnIndex}] output_tokens=${t.outputTokens} ctx=${(t.ctxPct * 100).toFixed(1)}%`;
    if (used + line.length > budget) break;
    parts.unshift(line);
    used += line.length;
  }
  return { text: parts.join("\n"), start: startIdx, end: endIdx };
}
