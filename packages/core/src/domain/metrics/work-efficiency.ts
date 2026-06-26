import { WORK_EFFICIENCY_FLOOR, WORK_EFFICIENCY_CEIL } from "../quality-proxy.js";
import { logScale } from "./log-scale.js";

/**
 * Trailing window (in turns) for the token-cost-per-artifact metric. Matches the recent-trend
 * window in session-trend so both read "recent" the same.
 */
export const WORK_WINDOW = 10;

/**
 * Token cost per useful turn = new context added over a trailing window ÷ artifacts produced
 * in that window. 0 artifacts in the window is maximally inefficient: the denominator floors
 * at 1 to surface the full window cost rather than divide by zero. Unlike a cumulative average
 * (which climbs ~linearly with turn count), this stays flat while healthy and rises only when
 * context grows faster than useful output appears.
 * @param newCtxTokens - new context introduced per turn (see newContextTokens).
 * @param isArtifact - per-turn artifact classification (see classifyArtifacts).
 * @param window - trailing window size in turns; defaults to WORK_WINDOW.
 */
export function workEfficiencyRaw(
  newCtxTokens: number[],
  isArtifact: boolean[],
  window = WORK_WINDOW,
): number[] {
  return newCtxTokens.map((_, i) => {
    const lo = Math.max(0, i - window + 1);
    let ctxSum = 0;
    let artifacts = 0;
    for (let k = lo; k <= i; k++) {
      ctxSum += newCtxTokens[k]!;
      if (isArtifact[k]!) artifacts++;
    }
    return ctxSum / Math.max(1, artifacts);
  });
}

/**
 * Log-scale tokens-per-artifact into [0, 1] between fixed anchors — the raw quantity spans
 * orders of magnitude, so a fixed anchor pair keeps the curve readable and cross-session
 * comparable.
 */
export function scaleWorkEfficiency(raw: number): number {
  return logScale(raw, WORK_EFFICIENCY_FLOOR, WORK_EFFICIENCY_CEIL);
}
