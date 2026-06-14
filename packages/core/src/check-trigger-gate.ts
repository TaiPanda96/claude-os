import { TriggerConfig } from "./types";

export function checkTriggerGate(
  trigger: TriggerConfig & { min_ctx_pct?: number; min_turns?: number },
  ctxPct: number,
  turnIndex: number,
): boolean {
  const minCtx = (trigger as any).min_ctx_pct ?? 20;
  const minTurns = (trigger as any).min_turns ?? 5;
  return ctxPct * 100 >= minCtx || turnIndex >= minTurns;
}
