import { existsSync, readFileSync } from "node:fs";
import { findJsonlForSession } from "../../ingest/find-jsonl-for-session.js";
import { Turn, AssistantRecord, UserRecord } from "../../types.js";

const TOKEN_SLICE_BUDGET_MULTIPLIER = 4; // Rough chars per token estimate
/**
 * Assembles a conversation slice from the session's JSONL file.
 * Reads the actual user/assistant messages for the session, filters to turns
 * at or after `fromTurnIndex`, and fits them within the token budget.
 * Falls back to turn-metrics text if no JSONL is found (e.g. policy-driven
 * compaction triggered before the first JSONL flush).
 */
export function assembleMemorySliceForCompaction(
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

  /**
   * Fallback for when no usable JSONL content is available (early compactions
   * before the first flush, or a file that yields no parseable blocks for this
   * slice): a sparse text representation built from turn metadata. The LLM can
   * still extract temporal/structural signal, just without the actual messages.
   * Format each turn as: [Turn 3] output_tokens=150 ctx=75.0%
   */
  const metricsFallback = (): { text: string; start: number; end: number } => {
    const parts: string[] = [];
    let used = 0;
    for (const t of [...slice].reverse()) {
      const line = `[Turn ${t.turnIndex}] output_tokens=${t.outputTokens} ctx=${(t.ctxPct * 100).toFixed(1)}%`;
      if (used + line.length > budget) break;
      parts.unshift(line);
      used += line.length;
    }
    return { text: parts.join("\n"), start: startIdx, end: endIdx };
  };

  if (!jsonlPath || !existsSync(jsonlPath)) return metricsFallback();

  // JSONL available — extract user/assistant messages for the slice
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

  // JSONL existed but yielded no usable blocks — fall back to turn metrics.
  return metricsFallback();
}
