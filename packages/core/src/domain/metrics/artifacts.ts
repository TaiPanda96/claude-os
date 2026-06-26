/**
 * Classify each turn as an "artifact" (a useful turn) when its output is at or above the
 * *running* (prefix) median output — a causal threshold, so a turn's classification never
 * depends on turns that haven't happened yet (a whole-session median would).
 * @param outputs - per-turn output token counts, in order.
 */
export function classifyArtifacts(outputs: number[]): boolean[] {
  return outputs.map((output, i) => {
    const prefix = outputs.slice(0, i + 1).sort((a, b) => a - b);
    const median = prefix[Math.floor((prefix.length - 1) / 2)] ?? 0;
    return output >= median;
  });
}
