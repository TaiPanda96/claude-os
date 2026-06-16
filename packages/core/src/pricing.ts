export const PRICING_VERSION = "2026-06-15";

export interface ModelPricing {
  inputPerM: number;
  outputPerM: number;
  cacheReadPerM: number;
  cacheWritePerM: number; // 5-min TTL rate; 1-hr TTL not distinguishable from usage object
}

export const MODEL_PRICING: Record<string, ModelPricing> = {
  "claude-sonnet-4-6": {
    inputPerM: 3.0,
    outputPerM: 15.0,
    cacheReadPerM: 0.3,
    cacheWritePerM: 3.75,
  },
  "claude-haiku-4-5-20251001": {
    inputPerM: 0.8,
    outputPerM: 4.0,
    cacheReadPerM: 0.08,
    cacheWritePerM: 1.0,
  },
  "claude-opus-4-8": {
    inputPerM: 15.0,
    outputPerM: 75.0,
    cacheReadPerM: 1.5,
    cacheWritePerM: 18.75,
  },
};

export function computeCostUsd(
  pricing: ModelPricing,
  inputTokens: number,
  outputTokens: number,
  cacheReadTokens: number,
  cacheCreationTokens: number,
): number {
  return (
    (inputTokens * pricing.inputPerM +
      outputTokens * pricing.outputPerM +
      cacheReadTokens * pricing.cacheReadPerM +
      cacheCreationTokens * pricing.cacheWritePerM) /
    1_000_000
  );
}

/** Returns MODEL_PRICING[model] or the Sonnet rate as a fallback. */
export function getPricing(model: string): { pricing: ModelPricing; fallback: boolean } {
  const pricing = MODEL_PRICING[model];
  if (pricing) return { pricing, fallback: false };
  return { pricing: MODEL_PRICING["claude-sonnet-4-6"]!, fallback: true };
}
