export interface SessionRow {
  id: string;
  name: string | null;
  model: string;
  status: string;
  current_ctx_pct: number | null;
  turn_count: number;
  last_active_at: number;
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

export interface SessionDetail {
  session: {
    id: string;
    name: string | null;
    model: string;
    ctxWindow: number;
  };
  turns: Turn[];
}

export type GCState = "clean" | "soft_gc" | "hard_gc";

export function gcState(ctxPct: number): GCState {
  if (ctxPct >= 0.8) return "hard_gc";
  if (ctxPct >= 0.6) return "soft_gc";
  return "clean";
}

export const GC_COLOR: Record<GCState, string> = {
  clean: "#34c759",
  soft_gc: "#ff9500",
  hard_gc: "#ff3b30",
};

export const SERVER = "http://localhost:7842";
