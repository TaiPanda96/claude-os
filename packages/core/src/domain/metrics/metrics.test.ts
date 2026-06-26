import { describe, expect, test } from "bun:test";
import { logScale } from "./log-scale.js";
import { effectiveInputs, newContextTokens } from "./new-context-tokens.js";
import { classifyArtifacts } from "./artifacts.js";
import { marginalDensityRaw, scaleMarginalDensity } from "./marginal-density.js";
import { workEfficiencyRaw, scaleWorkEfficiency } from "./work-efficiency.js";
import { computeMetrics } from "./compute-metrics.js";
import { sessionSummaryStats } from "./session-stats.js";
import type { MetricTurn } from "./metric-turn.js";

/** Minimal MetricTurn factory — fills the quality signals with neutral defaults. */
function turn(partial: Partial<MetricTurn> & Pick<MetricTurn, "turnIndex">): MetricTurn {
  return {
    outputTokens: 0,
    cumulativeTokens: 0,
    ctxPct: 0,
    outputDensity: 0,
    selfCorrectionCount: 0,
    repetitionScore: 0,
    ...partial,
  };
}

describe("logScale", () => {
  test("floor and below map to 0", () => {
    expect(logScale(1_000, 1_000, 100_000)).toBe(0);
    expect(logScale(10, 1_000, 100_000)).toBe(0);
  });
  test("ceil and above map to 1", () => {
    expect(logScale(100_000, 1_000, 100_000)).toBe(1);
    expect(logScale(10_000_000, 1_000, 100_000)).toBe(1);
  });
  test("geometric midpoint maps to 0.5", () => {
    // sqrt(1000 * 100000) = 10000
    expect(logScale(10_000, 1_000, 100_000)).toBeCloseTo(0.5, 10);
  });
  test("degenerate anchor range returns 0", () => {
    expect(logScale(5_000, 1_000, 1_000)).toBe(0);
  });
});

describe("effectiveInputs / newContextTokens", () => {
  const turns = [
    turn({ turnIndex: 0, cumulativeTokens: 1_000, outputTokens: 200 }),
    turn({ turnIndex: 1, cumulativeTokens: 1_500, outputTokens: 300 }),
    turn({ turnIndex: 2, cumulativeTokens: 1_800, outputTokens: 100 }),
  ];
  test("effective input is cumulative minus output", () => {
    expect(effectiveInputs(turns)).toEqual([800, 1_200, 1_700]);
  });
  test("turn 0 reads 0 new context; later turns are positive growth", () => {
    expect(newContextTokens(turns)).toEqual([0, 400, 500]);
  });
  test("shrinking effective input floors at 0, never negative", () => {
    const shrinking = [
      turn({ turnIndex: 0, cumulativeTokens: 2_000, outputTokens: 100 }),
      turn({ turnIndex: 1, cumulativeTokens: 1_000, outputTokens: 100 }),
    ];
    expect(newContextTokens(shrinking)).toEqual([0, 0]);
  });
});

describe("classifyArtifacts", () => {
  test("classifies against the running (prefix) median, not the whole-session median", () => {
    expect(classifyArtifacts([200, 300, 100])).toEqual([true, true, false]);
  });
  test("a single turn is always an artifact", () => {
    expect(classifyArtifacts([42])).toEqual([true]);
  });
});

describe("marginalDensity", () => {
  const turns = [
    turn({ turnIndex: 0, outputTokens: 200 }),
    turn({ turnIndex: 1, outputTokens: 300 }),
    turn({ turnIndex: 2, outputTokens: 100 }),
  ];
  const newCtx = [0, 400, 500];
  test("turn 0 is 0 (baseline context, not bloat)", () => {
    expect(marginalDensityRaw(turns, newCtx)[0]).toBe(0);
  });
  test("ratio is new context over output tokens", () => {
    const raw = marginalDensityRaw(turns, newCtx);
    expect(raw[1]).toBeCloseTo(400 / 300, 10);
    expect(raw[2]).toBe(5);
  });
  test("context growth with zero output saturates at the anchor, not 0", () => {
    const zeroOut = [
      turn({ turnIndex: 0, outputTokens: 0 }),
      turn({ turnIndex: 1, outputTokens: 0 }),
    ];
    // anchor is 8 (MARGINAL_DENSITY_ANCHOR); raw scales to exactly 1.
    expect(scaleMarginalDensity(marginalDensityRaw(zeroOut, [0, 1])[1]!)).toBe(1);
  });
  test("scale clamps at 1", () => {
    expect(scaleMarginalDensity(0)).toBe(0);
    expect(scaleMarginalDensity(80)).toBe(1);
  });
});

describe("workEfficiency", () => {
  test("token cost per artifact over the trailing window", () => {
    const newCtx = [0, 400, 500];
    const isArtifact = [true, true, false];
    expect(workEfficiencyRaw(newCtx, isArtifact, 10)).toEqual([0, 200, 450]);
  });
  test("zero artifacts in the window floors the denominator at 1", () => {
    expect(workEfficiencyRaw([600], [false], 10)).toEqual([600]);
  });
  test("scale is log between the work anchors (1k → 0, 100k → 1)", () => {
    expect(scaleWorkEfficiency(1_000)).toBe(0);
    expect(scaleWorkEfficiency(100_000)).toBe(1);
  });
});

describe("computeMetrics", () => {
  test("empty input yields no points", () => {
    expect(computeMetrics([])).toEqual([]);
  });

  test("produces one point per turn, each carrying every metric (raw + scaled)", () => {
    const turns = [
      turn({
        turnIndex: 0,
        cumulativeTokens: 1_000,
        outputTokens: 200,
        ctxPct: 0.1,
        outputDensity: 0.4,
      }),
      turn({
        turnIndex: 1,
        cumulativeTokens: 1_500,
        outputTokens: 300,
        ctxPct: 0.65,
        outputDensity: 0.2,
      }),
      turn({
        turnIndex: 2,
        cumulativeTokens: 1_800,
        outputTokens: 100,
        ctxPct: 0.85,
        outputDensity: 0.1,
      }),
    ];
    const points = computeMetrics(turns);
    expect(points).toHaveLength(3);

    // ctxPct is rendered as a percentage with one decimal; gcState comes from the thresholds.
    expect(points.map((p) => p.ctxPct)).toEqual([10, 65, 85]);
    expect(points.map((p) => p.gcState)).toEqual(["clean", "soft_gc", "hard_gc"]);

    // Every metric is present on every point.
    for (const p of points) {
      expect(Object.keys(p.metrics).sort()).toEqual([
        "marginalDensity",
        "quality",
        "workEfficiency",
      ]);
      for (const v of Object.values(p.metrics)) {
        expect(v.scaled).toBeGreaterThanOrEqual(0);
        expect(v.scaled).toBeLessThanOrEqual(1);
      }
    }

    // quality of turn 0: outputDensity 0.4 (→1 at anchor 0.4)*0.5 + 0.3 + 0.2 = 1.0
    expect(points[0]!.metrics.quality.raw).toBe(1);
    // bloat raw at turn 2 = newCtx 500 / output 100 = 5
    expect(points[2]!.metrics.marginalDensity.raw).toBe(5);
  });
});

describe("sessionSummaryStats", () => {
  test("empty points return the zeroed summary with the GC fields passed through", () => {
    const stats = sessionSummaryStats([], 0.42, "soft_gc");
    expect(stats.peakQuality).toBe(0);
    expect(stats.firstGCCtxPct).toBe(0.42);
    expect(stats.firstGCType).toBe("soft_gc");
  });

  test("summarises peak/current/efficiency from the computed points", () => {
    const turns = Array.from({ length: 12 }, (_, i) =>
      turn({
        turnIndex: i,
        cumulativeTokens: 1_000 + i * 500,
        outputTokens: 250,
        ctxPct: Math.min(0.95, 0.1 + i * 0.07),
        outputDensity: Math.max(0.05, 0.4 - i * 0.03),
      }),
    );
    const stats = sessionSummaryStats(computeMetrics(turns), null, null);
    expect(stats.peakQuality).toBeGreaterThan(0);
    expect(stats.currentQuality).toBeGreaterThanOrEqual(0);
    expect(Number.isInteger(stats.avgMarginalDensity)).toBe(true);
    expect(Number.isInteger(stats.currentWorkEfficiency)).toBe(true);
  });
});
