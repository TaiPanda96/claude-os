import { SELF_CORRECTION_MARKERS } from "../types";

export function countSelfCorrections(text: string): number {
  const lower = text.toLowerCase();
  return SELF_CORRECTION_MARKERS.reduce((n, marker) => {
    let count = 0,
      pos = 0;
    while ((pos = lower.indexOf(marker, pos)) !== -1) {
      count++;
      pos += marker.length;
    }
    return n + count;
  }, 0);
}
