/**
 * The GC state machine — THE single source of truth for the four-state union.
 *
 * Lives in its own bun-free domain module (like quality-proxy / session-trend) so the
 * Electron renderer can import the type without dragging in the `bun:sqlite`-coupled
 * `types.ts` barrel. Re-exported from `types.ts` for core's own consumers, so there is
 * exactly one definition both sides of the wire share.
 */
export type GCState = "clean" | "soft_gc" | "hard_gc" | "aged";

/**
 * GC context thresholds, as a fraction of the context window. THE single source of truth —
 * reference by name, never copy the values (see CLAUDE.md). Kept in this bun-free module so
 * the renderer and the metrics engine can read them without the `bun:sqlite`-coupled types.ts.
 */
export const GC_THRESHOLDS = {
  soft: 0.6,
  hard: 0.8,
} as const;

/**
 * Map a context-utilisation fraction (0–1) to its ctx-driven GC state. "aged" is
 * time/decay-driven and assigned elsewhere, so this never returns it.
 * @param ctxPct - context utilisation as a fraction (0–1).
 */
export function computeGCState(ctxPct: number): GCState {
  if (ctxPct >= GC_THRESHOLDS.hard) return "hard_gc";
  if (ctxPct >= GC_THRESHOLDS.soft) return "soft_gc";
  return "clean";
}
