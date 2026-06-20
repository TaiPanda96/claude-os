/**
 * The GC state machine — THE single source of truth for the four-state union.
 *
 * Lives in its own bun-free domain module (like quality-proxy / session-trend) so the
 * Electron renderer can import the type without dragging in the `bun:sqlite`-coupled
 * `types.ts` barrel. Re-exported from `types.ts` for core's own consumers, so there is
 * exactly one definition both sides of the wire share.
 */
export type GCState = "clean" | "soft_gc" | "hard_gc" | "aged";
