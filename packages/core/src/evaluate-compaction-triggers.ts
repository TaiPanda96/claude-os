import { v4 as uuidv4 } from "uuid";
import type { Database, Turn, TriggerConfig } from "./types.js";
import { TriggerTypeEnum } from "./types.js";
import { getPolicy, getLastCompactionEvent, getProject } from "./db.js";
import { compaction } from "./compaction.js";
import type { ClassifierPort, LlmPorts } from "./domain/llm-ports.js";
import type { CompactionEventSink } from "./domain/compaction-lifecycle-event.js";
import { noopEventSink } from "./domain/compaction-lifecycle-event.js";
import { llmPortFactory } from "./infrastructure/anthropic-llm.js";
import { checkTriggerGate } from "./check-trigger-gate.js";

const BUILT_IN_CLASSIFIERS: Record<string, string> = {
  [TriggerTypeEnum.ARCHITECTURAL_DECISION]: `Did this turn contain an architectural decision — a tech choice made, an approach selected, or a design pattern adopted that closes an open question? Respond with only "yes" or "no".`,
  [TriggerTypeEnum.OUTCOME_RESOLVED]: `Did this turn indicate that a task, ticket, or problem has been resolved or definitively answered? Respond with only "yes" or "no".`,
};

// Tracks turns since last compaction per session to enforce cooldown
const cooldownTracker = new Map<string, number>();

/**
 * Evaluates whether any compaction triggers are met for the current turn, and if so, initiates the compaction workflow.
 * @param db - Database instance for querying session and policy info, and recording compaction events.
 * @param sessionId  - ID of the session this turn belongs to, used for looking up the relevant compaction policy and cooldown state.
 * @param turn  - The current turn object, containing metadata like turn index and context percentage, which may be used in trigger evaluation.
 * @param recentOutput - The text output from the current turn, used for evaluating semantic triggers via the classifier port.
 * @param cwd - The current working directory of the session, which may be relevant for determining file paths during compaction.
 * @param ports - An optional set of LLM ports for classification and summarization; defaults to the Anthropic implementations. This allows for flexibility in how triggers are evaluated and compactions are performed.
 */
export function evaluateCompactionTriggers(
  db: Database,
  sessionId: string,
  turn: Turn,
  recentOutput: string,
  cwd: string,
  ports: LlmPorts = llmPortFactory(),
  sink: CompactionEventSink = noopEventSink,
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

      for (const trigger of policy.triggers) {
        const { fired, detail } = await checkTrigger(trigger, turn, recentOutput, ports.classifier);
        if (fired) {
          cooldownTracker.set(sessionId, 0);
          // Mint the audit-record id here so `compaction.triggered` and the rest of the
          // lifecycle stream share one eventId; compaction() reuses it for its DB row.
          const eventId = uuidv4();
          sink.emit({
            type: "compaction.triggered",
            eventId,
            sessionId,
            policyId: policy.id,
            triggeredBy: trigger.triggerType,
            detail,
            at: new Date().toISOString(),
          });
          await compaction(
            db,
            sessionId,
            policy,
            trigger.triggerType,
            detail,
            turn.cumulativeTokens,
            cwd,
            ports.summarizer,
            sink,
            eventId,
          );
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

/**
 * Helper to determine how many turns have occurred since the last compaction event for this session.
 * This is used to enforce the cooldown period defined in the compaction policy, preventing too-frequent compactions.
 * It uses a combination of database lookups and an in-memory tracker to provide an efficient and reasonably accurate count.
 * @param db
 * @param sessionId
 * @param currentTurnIndex
 * @returns
 */
function turnsSinceLastCompaction(
  db: Database,
  sessionId: string,
  currentTurnIndex: number,
): number {
  const last = getLastCompactionEvent(db, sessionId);
  if (!last || !last.completed_at) return currentTurnIndex + 1;
  // Approximate: we don't store the turn_index at compaction time, use a conservative estimate
  return cooldownTracker.get(sessionId) ?? currentTurnIndex + 1;
}

/**
 * Check if a given trigger condition is met based on the current turn and recent output, using the provided classifier port for semantic triggers.
 * @param trigger
 * @param turn
 * @param recentOutput
 * @param classifier
 * @returns
 */
async function checkTrigger(
  trigger: TriggerConfig,
  turn: Turn,
  recentOutput: string,
  classifier: ClassifierPort,
): Promise<{ fired: boolean; detail: string }> {
  const { ctxPct, turnIndex } = turn;

  switch (trigger.triggerType) {
    case TriggerTypeEnum.TURN_CADENCE:
      if ((turnIndex + 1) % trigger.every === 0)
        return {
          fired: true,
          detail: `turn ${turnIndex + 1} (every ${trigger.every})`,
        };
      break;

    case TriggerTypeEnum.CTX_THRESHOLD:
      if (ctxPct * 100 >= trigger.pct)
        return {
          fired: true,
          detail: `ctx reached ${(ctxPct * 100).toFixed(1)}% (threshold ${trigger.pct}%)`,
        };
      break;

    case TriggerTypeEnum.SEMANTIC_EVENT:
      if (checkTriggerGate(trigger, ctxPct, turnIndex)) {
        const fired = await classifier.classify(trigger.classifier, recentOutput);
        if (fired) return { fired: true, detail: "semantic: custom classifier fired" };
      }
      break;

    case TriggerTypeEnum.ARCHITECTURAL_DECISION:
      if (checkTriggerGate(trigger, ctxPct, turnIndex)) {
        const fired = await classifier.classify(
          BUILT_IN_CLASSIFIERS[TriggerTypeEnum.ARCHITECTURAL_DECISION]!,
          recentOutput,
        );
        if (fired)
          return {
            fired: true,
            detail: "semantic: architectural decision detected",
          };
      }
      break;

    case TriggerTypeEnum.OUTCOME_RESOLVED:
      if (checkTriggerGate(trigger, ctxPct, turnIndex)) {
        const fired = await classifier.classify(
          BUILT_IN_CLASSIFIERS[TriggerTypeEnum.OUTCOME_RESOLVED]!,
          recentOutput,
        );
        if (fired) return { fired: true, detail: "semantic: outcome resolved detected" };
      }
      break;

    case TriggerTypeEnum.COMBINED: {
      if (trigger.mode === "any") {
        for (const sub of trigger.triggers) {
          const result = await checkTrigger(sub, turn, recentOutput, classifier);
          if (result.fired) return result;
        }
      } else {
        const results = await Promise.all(
          trigger.triggers.map((sub) => checkTrigger(sub, turn, recentOutput, classifier)),
        );
        if (results.every((r) => r.fired))
          return {
            fired: true,
            detail: results.map((r) => r.detail).join(" + "),
          };
      }
      break;
    }
  }
  return { fired: false, detail: "" };
}
