export interface SessionRow {
  id: string;
  name: string | null;
  model: string;
  status: string;
  ctx_window: number;
  current_ctx_pct: number | null;
  turn_count: number;
  last_active_at: number;
  // Estimated dollar cost over the session's turns; pricing_fallback is true
  // when the model isn't in MODEL_PRICING and a fallback rate was used.
  cost_usd: number;
  pricing_fallback: boolean;
  // Project topology — present when server JOINs projects table
  project_id: string | null;
  project_name: string | null;
  forked_from: string | null;
}

export interface Project {
  id: string;
  cwd: string;
  name: string;
  created_at: number;
  session_count: number;
  last_active_at: number | null;
  has_policy: 0 | 1;
  // Present when a compaction policy exists for the project (null otherwise).
  policy_name: string | null;
  policy_active: 0 | 1 | null;
}

// ── Policy types (mirrors packages/core/src/types.ts) ──────────────────────

export type UpdateMode = "overwrite" | "append" | "merge";
export type DecayScope = "session" | "project" | "permanent";

export interface MemoryFile {
  filename: string;
  description: string;
  update_mode: UpdateMode;
  decay: DecayScope;
  max_tokens?: number;
}

export type TriggerType =
  | "turn_cadence"
  | "ctx_threshold"
  | "architectural_decision"
  | "outcome_resolved"
  | "semantic_event";

export type TriggerConfig =
  | { triggerType: "turn_cadence"; every: number }
  | { triggerType: "ctx_threshold"; pct: number }
  | { triggerType: "architectural_decision"; min_ctx_pct: number; min_turns: number }
  | { triggerType: "outcome_resolved"; min_ctx_pct: number; min_turns: number }
  | { triggerType: "semantic_event"; classifier: string; min_ctx_pct: number; min_turns: number };

export interface CompactionPolicy {
  id: string;
  project_id: string;
  name: string;
  active: boolean;
  triggers: TriggerConfig[];
  memory_schema: MemoryFile[];
  cooldown_turns: number;
  created_at: string;
  updated_at: string;
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
  selfCorrectionCount: number;
  repetitionScore: number;
  outputDensity: number;
}

export interface GCEvent {
  id: string;
  session_id: string;
  gc_type: GCState;
  ctx_pct_at_trigger: number;
  created_at: number;
}

export interface MemoryFileResult {
  filename: string;
  bytes_written: number;
  content: string;
  update_mode: string;
}

export interface CompactionEventDetail {
  id: string;
  tokens_at_trigger: number;
  output_size_tokens: number;
  status: string;
  started_at: string;
  completed_at: string | null;
  files_written: MemoryFileResult[];
}

// Kept for the savings-preview path (only needs token counts)
export interface CompactionEventSummary {
  id: string;
  tokens_at_trigger: number;
  output_size_tokens: number;
  status: string;
  completed_at: string | null;
}

export interface MemoryArtifact {
  filename: string;
  bytes: number;
  modified_at: number;
  content: string;
}

export interface SessionDetail {
  session: {
    id: string;
    name: string | null;
    model: string;
    ctxWindow: number;
    forkedFrom: string | null;
  };
  turns: Turn[];
  forks: string[];
  lastCompaction: CompactionEventSummary | null;
}

export type GCState = "clean" | "soft_gc" | "hard_gc";

export function gcState(ctxPct: number): GCState {
  if (ctxPct >= 0.8) return "hard_gc";
  if (ctxPct >= 0.6) return "soft_gc";
  return "clean";
}

// Dot/glyph colors — matches design system gc-states.css
export const GC_COLOR: Record<GCState, string> = {
  clean:   "#22C55E",
  soft_gc: "#F59E0B",
  hard_gc: "#EF4444",
};

// Text colors for badges, labels, numeric values
export const GC_TEXT: Record<GCState, string> = {
  clean:   "#4ADE80",
  soft_gc: "#FBBF24",
  hard_gc: "#F87171",
};

export const SERVER = "http://localhost:7842";

// Model pricing for client-side savings estimates — mirrors packages/core/src/pricing.ts
export const MODEL_PRICING: Record<string, { inputPerM: number }> = {
  "claude-sonnet-4-6":        { inputPerM: 3.0 },
  "claude-haiku-4-5-20251001": { inputPerM: 0.8 },
  "claude-opus-4-8":          { inputPerM: 15.0 },
};
