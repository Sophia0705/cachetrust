import { describe, expect, it } from "vitest";
import type { ObservedTurboTask } from "../src/verification/turbo-runner.js";
import { classifyVerification, type VerdictInput } from "../src/verification/verdict.js";

function observed(status: "HIT" | "MISS", hash: string): ObservedTurboTask {
  return {
    id: "app#build", hash,
    cache: { status, local: status === "HIT", remote: false },
    outputs: ["apps/app/dist/**"], excludedOutputs: [],
  };
}

function input(overrides: Partial<VerdictInput> = {}): VerdictInput {
  return {
    expectedTasks: [{ id: "app#build", expectedAfterMutation: "HIT" }],
    v1Tasks: [observed("MISS", "v1")],
    cacheTasks: [observed("HIT", "v1")],
    baselineATasks: [observed("MISS", "v1")],
    baselineBTasks: [observed("MISS", "v1")],
    outputCoverageValid: true,
    baselinesStable: true,
    cacheMatchesBaseline: true,
    rawCacheMatchesBaseline: true,
    normalizationUsed: false,
    mutationEffectProven: true,
    functionalDifferenceConfirmed: false,
    ...overrides,
  };
}

describe("generic verification verdict", () => {
  it("passes proven local reuse", () => {
    expect(classifyVerification(input())).toMatchObject({ status: "PASS", reasonCodes: ["CORRECT_REUSE"] });
  });

  it("passes correct invalidation", () => {
    expect(classifyVerification(input({
      expectedTasks: [{ id: "app#build", expectedAfterMutation: "MISS" }],
      cacheTasks: [observed("MISS", "v2")],
      baselineATasks: [observed("MISS", "v2")], baselineBTasks: [observed("MISS", "v2")],
    }))).toMatchObject({ status: "PASS", reasonCodes: ["CORRECT_INVALIDATION"] });
  });

  it("requires genuine HIT proof", () => {
    expect(classifyVerification(input({ cacheTasks: [observed("MISS", "v1")] })))
      .toMatchObject({ status: "INCONCLUSIVE", reasonCodes: ["LOCAL_HIT_UNPROVEN"] });
  });

  it("reports stable, functionally confirmed stale reuse", () => {
    expect(classifyVerification(input({
      cacheMatchesBaseline: false, rawCacheMatchesBaseline: false, functionalDifferenceConfirmed: true,
    }))).toMatchObject({ status: "MISMATCH", reasonCodes: ["CONFIRMED_STALE_REUSE"] });
  });

  it("does not report mismatch for nondeterministic baselines", () => {
    expect(classifyVerification(input({
      baselinesStable: false, cacheMatchesBaseline: false, functionalDifferenceConfirmed: true,
    }))).toMatchObject({ status: "INCONCLUSIVE", reasonCodes: ["NONDETERMINISTIC_BASELINE"] });
  });

  it("fails closed on output mismatch and unsafe normalization", () => {
    expect(classifyVerification(input({ outputCoverageValid: false })))
      .toMatchObject({ status: "INCONCLUSIVE", reasonCodes: ["OUTPUT_COVERAGE_MISMATCH"] });
    expect(classifyVerification(input({
      normalizationUsed: true, rawCacheMatchesBaseline: false,
      cacheMatchesBaseline: true, functionalDifferenceConfirmed: true,
    }))).toMatchObject({ status: "INCONCLUSIVE", reasonCodes: ["NORMALIZATION_UNSAFE"] });
  });
});
