/**
 * Log-scale a raw value between two anchors into [0, 1]: `floor` and below map to 0,
 * `ceil` and above to 1, the geometric midpoint to 0.5. Used where the raw quantity spans
 * orders of magnitude and linear scaling would crush the low end.
 * @param value - the raw quantity to scale.
 * @param floor - lower anchor; maps to 0.
 * @param ceil - upper anchor; maps to 1.
 */
export function logScale(value: number, floor: number, ceil: number): number {
  const lv = Math.log10(Math.max(1, value));
  const lo = Math.log10(floor);
  const hi = Math.log10(ceil);
  if (hi <= lo) return 0;
  return Math.min(1, Math.max(0, (lv - lo) / (hi - lo)));
}
