import { bigrams } from "./bigrams.js";

export function bigramOverlap(a: string, b: string): number {
  if (!a || !b) return 0;
  const bgA = bigrams(a),
    bgB = bigrams(b);
  if (bgA.size === 0 || bgB.size === 0) return 0;
  let shared = 0;
  for (const bg of bgA) {
    if (bgB.has(bg)) shared++;
  }
  return shared / Math.max(bgA.size, bgB.size);
}
