import { MODEL_CONTEXT_WINDOWS, CONTEXT_WINDOW_TIERS } from "../types.js";

/**
 * Resolves the real context window (in tokens) for a model.
 *
 * The active window is a property of the *account plan*, not the model: the Max
 * plan lifts Opus/Sonnet from 200K to 1M, but the session JSONL only ever records
 * the base model id ("claude-opus-4-8", never "claude-opus-4-8[1m]"). So a static
 * model→window map cannot be the sole source of truth. We layer two corrections:
 *
 *   1. CLAUDE_OS_CONTEXT_WINDOW env override — the plan's window, set once. This is
 *      the correct fix for low-usage sessions a plan map can't otherwise distinguish
 *      (a 150K Max session looks identical to a 150K Pro session in the data).
 *   2. Empirical floor — observed effective-input tokens are ground truth: if a turn
 *      consumed 382K, the window is provably ≥382K, so the 200K default was wrong.
 *      We round that observation up to the smallest known tier that fits.
 *
 * The result is the max of (override-or-default) and the empirical floor, so the
 * window is never reported below proven usage and ctxPct can't be falsely clamped
 * to 100%.
 *
 * @param observedEffectiveInput the largest effective-input seen so far for the
 *   session (input + cache_read + cache_creation). 0 when no usage is known yet.
 */
export function resolveContextWindow(model: string, observedEffectiveInput = 0): number {
  const base = contextWindowOverride() ?? MODEL_CONTEXT_WINDOWS[model] ?? 200_000;
  // Smallest tier that fits the observation; if usage exceeds every known tier,
  // fall back to the observation itself so the window still bounds it.
  const empiricalFloor =
    CONTEXT_WINDOW_TIERS.find((tier) => tier >= observedEffectiveInput) ?? observedEffectiveInput;
  return Math.max(base, empiricalFloor);
}

/** Parses CLAUDE_OS_CONTEXT_WINDOW; ignores absent/invalid values. */
function contextWindowOverride(): number | undefined {
  const raw = process.env.CLAUDE_OS_CONTEXT_WINDOW;
  if (!raw) return undefined;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : undefined;
}
