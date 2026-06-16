import type { Turn } from "./types.js";
import { qualityForTurn } from "./domain/quality-proxy.js";
import { computeSessionTrend, type SessionTrend } from "./domain/session-trend.js";

// SessionHealthStats is the session-trend core minus the internal recentSlope,
// which is an implementation detail of the projection rather than part of the API.
export type SessionHealthStats = Omit<SessionTrend, "recentSlope">;

export function computeSessionHealthStats(turns: Turn[]): SessionHealthStats {
  const valid = turns.filter((t) => t.ctxPct <= 1.0);
  const { recentSlope: _recentSlope, ...stats } = computeSessionTrend(
    valid.map((t) => ({
      ctxPct: Math.round(t.ctxPct * 1000) / 10,
      quality: qualityForTurn(t),
    })),
  );
  return stats;
}
