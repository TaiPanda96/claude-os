import { join } from "node:path";
import { v4 as uuidv4 } from "uuid";
import type { Database } from "./types.js";
import type { CompactionPolicy, CompactionEvent, CompactionFileResult } from "./types.js";
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
      const slice = assembleSliceToCompact(turns, Math.max(0, fromTurnIndex), maxTokens);
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

function assembleSliceToCompact(
  turns: Turn[],
  fromTurnIndex: number,
  maxTokens: number,
): { text: string; start: number; end: number } {
  const slice = turns.filter((t) => t.turnIndex >= fromTurnIndex);
  if (slice.length === 0) return { text: "", start: fromTurnIndex, end: fromTurnIndex };

  const parts: string[] = [];
  // Budget: 4 chars per token estimate, newest turns first to preserve recency
  const budget = maxTokens * TOKEN_SLICE_BUDGET_MULTIPLIER;
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
