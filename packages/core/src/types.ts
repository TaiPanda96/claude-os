export type { Database } from "bun:sqlite";

export type GCState = "clean" | "soft_gc" | "hard_gc" | "aged";

export type SessionStatus = "active" | "closed" | "archived";

export type OutcomeStatus = "unresolved" | "resolved" | "stalled";

export interface Session {
  id: string;
  name: string | null;
  model: string;
  ctxWindow: number;
  createdAt: number;
  lastActiveAt: number;
  status: SessionStatus;
  outcomeStatus: OutcomeStatus;
  forkedFrom: string | null;
  projectId: string | null;
}

export interface Turn {
  id: string;
  sessionId: string;
  turnIndex: number;
  inputTokens: number;
  outputTokens: number;
  cumulativeTokens: number;
  ctxPct: number;
  latencyMs: number;
  stopReason: string | null;
  createdAt: number;
  // Quality proxy signals
  selfCorrectionCount: number; // occurrences of hedging/correction phrases
  repetitionScore: number; // 0–1, bigram overlap with previous turn output
  outputDensity: number; // output_tokens / effectiveInputTokens
  // Cache / extended fields (present when ingested from JSONL or live wrapper)
  cacheReadTokens: number;
  cacheCreationTokens: number;
  effectiveInputTokens: number;
  pricingVersion: string; // PRICING_VERSION constant from pricing.ts, snapshotted at ingest
  cwd?: string;
}

// Phrases that indicate the model is revising or hedging mid-response
/**
 * A Static List of Phrases that may indicate self-correction or hedging in the model's output.
 * This is used as a heuristic signal for identifying turns where the model may be uncertain or revising its response,
 * which can be a useful quality proxy for triggering compactions or other interventions. The list includes common phrases that suggest the model is changing its mind, clarifying, or acknowledging a mistake. Note that this is not an exhaustive list and may need to be updated over time as new patterns of self-correction emerge in model outputs.
 */
export const SELF_CORRECTION_MARKERS = [
  "actually,",
  "actually —",
  "let me revise",
  "let me rephrase",
  "to clarify,",
  "to be more precise",
  "i should clarify",
  "correction:",
  "more accurately,",
  "wait,",
  "i was wrong",
  "let me reconsider",
  "upon reflection",
  "i misspoke",
  "to be clear,",
  "i need to correct",
  "You're right,",
  "I apologize,",
  "i take that back",
  "i need to correct myself",
] as const;

export const GC_THRESHOLDS = {
  soft: 0.6,
  hard: 0.8,
} as const;

export interface GCEvent {
  id: string;
  sessionId: string;
  gcType: GCState;
  ctxPctAtTrigger: number;
  createdAt: number;
}

export interface Outcome {
  id: string;
  sessionId: string;
  label: string;
  resolved: boolean;
  resolvedAt: number | null;
}

export interface SessionHealth {
  session: Session;
  gcState: GCState;
  ctxPct: number;
  turnCount: number;
  totalInputTokens: number;
  totalOutputTokens: number;
}

export const MODEL_CONTEXT_WINDOWS: Record<string, number> = {
  "claude-opus-4-8": 200_000,
  "claude-opus-4-7": 200_000,
  "claude-sonnet-4-6": 200_000,
  "claude-haiku-4-5-20251001": 200_000,
  "claude-3-5-sonnet-20241022": 200_000,
  "claude-3-5-haiku-20241022": 200_000,
};

export interface AssistantRecord {
  type: "assistant";
  uuid: string;
  parentUuid?: string;
  sessionId: string;
  timestamp: string;
  cwd: string;
  message: {
    model: string;
    stop_reason: string | null;
    content: Array<{ type: string; text?: string }>;
    usage: {
      input_tokens: number;
      output_tokens: number;
      cache_read_input_tokens?: number;
      cache_creation_input_tokens?: number;
    };
  };
}

export interface UserRecord {
  type: "user";
  uuid: string;
  sessionId: string;
  timestamp: string;
  message: { content: string | Array<{ type: string; text?: string }> };
}

export function computeGCState(ctxPct: number): GCState {
  if (ctxPct >= GC_THRESHOLDS.hard) return "hard_gc";
  if (ctxPct >= GC_THRESHOLDS.soft) return "soft_gc";
  return "clean";
}

export interface Project {
  id: string;
  cwd: string;
  name: string;
  createdAt: number;
}

export enum TriggerTypeEnum {
  TURN_CADENCE = "turn_cadence",
  CTX_THRESHOLD = "ctx_threshold",
  SEMANTIC_EVENT = "semantic_event",
  ARCHITECTURAL_DECISION = "architectural_decision",
  OUTCOME_RESOLVED = "outcome_resolved",
  COMBINED = "combined",
  MANUAL = "manual",
}

export type TriggerConfig =
  | { triggerType: TriggerTypeEnum.TURN_CADENCE; every: number }
  | { triggerType: TriggerTypeEnum.CTX_THRESHOLD; pct: number }
  | {
      triggerType: TriggerTypeEnum.SEMANTIC_EVENT;
      classifier: string;
      min_ctx_pct: number; // default 20
      min_turns: number; // default 5
    }
  | {
      triggerType: TriggerTypeEnum.ARCHITECTURAL_DECISION;
      min_ctx_pct: number; // default 20
      min_turns: number; // default 5
    }
  | {
      triggerType: TriggerTypeEnum.OUTCOME_RESOLVED;
      min_ctx_pct: number; // default 10
      min_turns: number; // default 5
    }
  | {
      triggerType: TriggerTypeEnum.COMBINED;
      triggers: Exclude<TriggerConfig, { triggerType: TriggerTypeEnum.COMBINED }>[];
      mode: "any" | "all";
    };

export type UpdateMode = "overwrite" | "append" | "merge";
export type DecayScope = "session" | "project" | "permanent";

export interface MemoryFile {
  filename: string;
  description: string;
  update_mode: UpdateMode;
  decay: DecayScope;
  max_tokens?: number; // default 8000; merge existing file capped separately at 4000
}

export interface CompactionPolicy {
  id: string;
  project_id: string;
  name: string;
  active: boolean;
  triggers: TriggerConfig[];
  memory_schema: MemoryFile[];
  cooldown_turns: number; // default 2
  created_at: string;
  updated_at: string;
}

export type CompactionStatus = "running" | "completed" | "failed";

export interface CompactionFileResult {
  filename: string;
  update_mode: UpdateMode;
  bytes_written: number;
  preview: string; // first 200 chars
}

export interface CompactionEvent {
  id: string;
  session_id: string;
  policy_id: string;
  triggered_by: TriggerTypeEnum;
  trigger_detail: string;
  files_written: CompactionFileResult[];
  tokens_at_trigger: number;
  output_size_tokens: number;
  status: CompactionStatus;
  started_at: string;
  completed_at: string | null;
  error: string | null;
}
