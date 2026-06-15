// The per-turn quality proxy — THE single source of truth.
//
// This formula and its anchor constants were previously duplicated between
// packages/core/src/health.ts (server-side stats) and
// apps/desktop/src/renderer/quality.ts (renderer). Both now import from here,
// so there is no longer a "change both together" hazard.

// Fixed upper bound for output_density derived from empirical data (observed max ~0.34).
// Using a fixed anchor instead of per-session min-max keeps quality scores comparable
// across sessions — otherwise a weak session that peaks at 0.15 density gets stretched
// to 1.0, making it look identical to a strong session that peaks at 0.34.
export const OUTPUT_DENSITY_ANCHOR = 0.4;

// self_correction_count is a raw occurrence count (16 marker phrases, see countSelfCorrections).
// Dividing by a soft ceiling preserves magnitude — 3 corrections penalises more than 1.
// Ceiling of 5 is conservative given 16 markers; the clamp handles any outlier above it.
export const SELF_CORRECTION_ANCHOR = 5;

// Quality floor used for the turnsToInflection projection.
// Below this the session is producing low-value output.
export const QUALITY_FLOOR = 0.3;

// Fixed soft ceiling for the context-bloat ratio (new context tokens introduced
// in a turn ÷ that turn's output tokens). At or above this the turn is treated as
// "fully bloated" — context ballooning with little output to show for it.
// A fixed anchor (rather than per-session min-max) keeps the plotted curve
// comparable across sessions and stops a single spike — e.g. one large file read —
// from compressing every other turn toward zero. 8 is a conservative estimate;
// the clamp handles outliers above it.
export const MARGINAL_DENSITY_ANCHOR = 8;

// Anchors for the token-cost-per-artifact curve, in new-context tokens per useful
// turn (log-scaled between them). ~1k tok/artifact reads as efficient → 0, ~100k
// as badly degraded → 1, the geometric midpoint (~10k) sits at 0.5. Log-scaled
// because the raw quantity spans orders of magnitude across sessions; conservative
// estimates, and the scale clamps anything outside the range.
export const WORK_EFFICIENCY_FLOOR = 1_000;
export const WORK_EFFICIENCY_CEIL = 100_000;

// The three signals the quality proxy is computed from. Declared structurally so that
// both the core `Turn` and the renderer's local `Turn` satisfy it without sharing a
// nominal type across the package boundary.
export interface QualitySignals {
  outputDensity: number;
  selfCorrectionCount: number;
  repetitionScore: number;
}

// Weighted blend of output density (0.5), absence of self-correction (0.3), and absence
// of repetition (0.2), rounded to 2 decimals. Range 0–1.
export function qualityForTurn(t: QualitySignals): number {
  return (
    Math.round(
      (Math.min(1, (t.outputDensity ?? 0) / OUTPUT_DENSITY_ANCHOR) * 0.5 +
        (1 -
          Math.min(1, (t.selfCorrectionCount ?? 0) / SELF_CORRECTION_ANCHOR)) *
          0.3 +
        (1 - (t.repetitionScore ?? 0)) * 0.2) *
        100,
    ) / 100
  );
}
