import type { MetricTurn } from "./metric-turn.js";
import { MARGINAL_DENSITY_ANCHOR } from "../quality-proxy.js";

/**
 * Context-bloat ratio per turn = new context tokens introduced ÷ that turn's output tokens.
 * Turn 0 is 0 (baseline context, not bloat). A turn that grows context with zero output is
 * the worst case, not the best — it saturates at the anchor rather than reporting 0 (a guard
 * at 0 would invert the signal).
 * @param turns - the session's turns, in order.
 * @param newCtxTokens - new context introduced per turn (see newContextTokens).
 */
export function marginalDensityRaw(turns: MetricTurn[], newCtxTokens: number[]): number[] {
  return turns.map((t, i) => {
    if (i === 0) return 0;
    if (t.outputTokens > 0) return newCtxTokens[i]! / t.outputTokens;
    return newCtxTokens[i]! > 0 ? MARGINAL_DENSITY_ANCHOR : 0;
  });
}

/**
 * Fixed-anchor scale into [0, 1] (not per-session min-max) so the curve is comparable across
 * sessions and immune to a single outlier flattening everything else.
 */
export function scaleMarginalDensity(raw: number): number {
  return Math.min(1, raw / MARGINAL_DENSITY_ANCHOR);
}
