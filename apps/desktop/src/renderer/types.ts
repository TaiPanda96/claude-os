export interface SessionRow {
  id: string;
  name: string | null;
  model: string;
  status: string;
  ctx_window: number;
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
