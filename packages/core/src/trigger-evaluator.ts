import Anthropic from "@anthropic-ai/sdk";
import type { Database, Turn, CompactionPolicy, TriggerConfig } from "./types.js";
import { TriggerTypeEnum } from "./types.js";
import { getPolicy, getLastCompactionEvent, getProject } from "./db.js";
import { runCompaction } from "./compaction.js";

const CLASSIFIER_MODEL = "claude-haiku-4-5-20251001";

const BUILT_IN_CLASSIFIERS: Record<string, string> = {
  [TriggerTypeEnum.ARCHITECTURAL_DECISION]: `Did this turn contain an architectural decision — a tech choice made, an approach selected, or a design pattern adopted that closes an open question? Respond with only "yes" or "no".`,
  [TriggerTypeEnum.OUTCOME_RESOLVED]: `Did this turn indicate that a task, ticket, or problem has been resolved or definitively answered? Respond with only "yes" or "no".`,
};

// Tracks turns since last compaction per session to enforce cooldown
const cooldownTracker = new Map<string, number>();

function turnsSinceLastCompaction(db: Database, sessionId: string, currentTurnIndex: number): number {
  const last = getLastCompactionEvent(db, sessionId);
  if (!last || !last.completed_at) return currentTurnIndex + 1;
  // Approximate: we don't store the turn_index at compaction time, use a conservative estimate
  return cooldownTracker.get(sessionId) ?? currentTurnIndex + 1;
}

async function evaluateSemanticTrigger(
  classifierPrompt: string,
  recentOutput: string,
): Promise<boolean> {
  if (!recentOutput.trim()) return false;
  try {
    const client = new Anthropic();
    const response = await client.messages.create({
      model: CLASSIFIER_MODEL,
      max_tokens: 5,
      messages: [
        {
          role: "user",
          content: `${classifierPrompt}\n\nSESSION OUTPUT:\n${recentOutput.slice(0, 2000)}`,
        },
      ],
    });
    const text = response.content
      .filter((b) => b.type === "text")
      .map((b) => (b as { text: string }).text)
      .join("")
      .toLowerCase()
      .trim();
    return text.startsWith("yes");
  } catch {
    return false;
  }
}

function gateCleared(trigger: TriggerConfig & { min_ctx_pct?: number; min_turns?: number }, ctxPct: number, turnIndex: number): boolean {
  const minCtx = (trigger as any).min_ctx_pct ?? 20;
  const minTurns = (trigger as any).min_turns ?? 5;
  return ctxPct * 100 >= minCtx || turnIndex >= minTurns;
}

async function checkTrigger(
  trigger: TriggerConfig,
  turn: Turn,
  recentOutput: string,
): Promise<{ fired: boolean; detail: string }> {
  const { ctxPct, turnIndex } = turn;

  switch (trigger.triggerType) {
    case TriggerTypeEnum.TURN_CADENCE:
      if ((turnIndex + 1) % trigger.every === 0)
        return { fired: true, detail: `turn ${turnIndex + 1} (every ${trigger.every})` };
      break;

    case TriggerTypeEnum.CTX_THRESHOLD:
      if (ctxPct * 100 >= trigger.pct)
        return { fired: true, detail: `ctx reached ${(ctxPct * 100).toFixed(1)}% (threshold ${trigger.pct}%)` };
      break;

    case TriggerTypeEnum.SEMANTIC_EVENT:
      if (gateCleared(trigger, ctxPct, turnIndex)) {
        const fired = await evaluateSemanticTrigger(trigger.classifier, recentOutput);
        if (fired) return { fired: true, detail: "semantic: custom classifier fired" };
      }
      break;

    case TriggerTypeEnum.ARCHITECTURAL_DECISION:
      if (gateCleared(trigger, ctxPct, turnIndex)) {
        const fired = await evaluateSemanticTrigger(BUILT_IN_CLASSIFIERS[TriggerTypeEnum.ARCHITECTURAL_DECISION]!, recentOutput);
        if (fired) return { fired: true, detail: "semantic: architectural decision detected" };
      }
      break;

    case TriggerTypeEnum.OUTCOME_RESOLVED:
      if (gateCleared(trigger, ctxPct, turnIndex)) {
        const fired = await evaluateSemanticTrigger(BUILT_IN_CLASSIFIERS[TriggerTypeEnum.OUTCOME_RESOLVED]!, recentOutput);
        if (fired) return { fired: true, detail: "semantic: outcome resolved detected" };
      }
      break;

    case TriggerTypeEnum.COMBINED: {
      if (trigger.mode === "any") {
        for (const sub of trigger.triggers) {
          const result = await checkTrigger(sub, turn, recentOutput);
          if (result.fired) return result;
        }
      } else {
        const results = await Promise.all(trigger.triggers.map((sub) => checkTrigger(sub, turn, recentOutput)));
        if (results.every((r) => r.fired))
          return { fired: true, detail: results.map((r) => r.detail).join(" + ") };
      }
      break;
    }
  }
  return { fired: false, detail: "" };
}

// Called after every turn completes in wrapper.ts — fire and forget for semantic triggers
export function evaluateTriggers(
  db: Database,
  sessionId: string,
  turn: Turn,
  recentOutput: string,
  cwd: string,
): void {
  // Run async without blocking the turn response
  (async () => {
    try {
      // Look up project → policy
      const session = db
        .prepare(`SELECT project_id FROM sessions WHERE id = $id`)
        .get({ $id: sessionId }) as { project_id: string | null } | undefined;
      if (!session?.project_id) return;

      const policy = getPolicy(db, session.project_id);
      if (!policy || !policy.active) return;

      // Cooldown check
      const sinceLastCompaction = turnsSinceLastCompaction(db, sessionId, turn.turnIndex);
      if (sinceLastCompaction < policy.cooldown_turns) return;

      // Evaluate triggers
      for (const trigger of policy.triggers) {
        const { fired, detail } = await checkTrigger(trigger, turn, recentOutput);
        if (fired) {
          cooldownTracker.set(sessionId, 0);
          await runCompaction(db, sessionId, policy, trigger.triggerType, detail, turn.cumulativeTokens, cwd);
          return; // one compaction per turn
        }
      }

      // Increment turns since last compaction
      const current = cooldownTracker.get(sessionId) ?? 0;
      cooldownTracker.set(sessionId, current + 1);
    } catch (err) {
      console.error("[trigger-evaluator]", err);
    }
  })();
}
