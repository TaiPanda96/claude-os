import type { MetricTurn } from "./metric-turn.js";

/**
 * Effective input per turn = context-window tokens fed to the model that turn (cumulative
 * tokens minus that turn's own output). Its turn-over-turn growth is the new context
 * introduced that turn — the shared input for the bloat-rate and work-efficiency metrics.
 * @param turns - the session's turns, in order.
 */
export function effectiveInputs(turns: MetricTurn[]): number[] {
  return turns.map((t) => t.cumulativeTokens - t.outputTokens);
}

/**
 * New context introduced per turn — the turn-over-turn growth of effective input, floored
 * at 0. Turn 0 reads 0: its context is the fixed base prompt (system prompt + tool defs +
 * CLAUDE.md), a one-time cost, not bloat introduced by the session.
 * @param turns - the session's turns, in order.
 */
export function newContextTokens(turns: MetricTurn[]): number[] {
  const eff = effectiveInputs(turns);
  return eff.map((v, i) => (i === 0 ? 0 : Math.max(0, v - eff[i - 1]!)));
}
