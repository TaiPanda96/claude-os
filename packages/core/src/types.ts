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
  outputDensity: number; // output_tokens / input_tokens
}

// Phrases that indicate the model is revising or hedging mid-response
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
] as const;

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
  "claude-sonnet-4-6": 200_000,
  "claude-haiku-4-5-20251001": 200_000,
  "claude-3-5-sonnet-20241022": 200_000,
  "claude-3-5-haiku-20241022": 200_000,
};

export const GC_THRESHOLDS = {
  soft: 0.6,
  hard: 0.8,
} as const;

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
