import { describe, expect, it } from "vitest";
import {
  classifyBracketExperiment,
  type BracketExperimentEvidence,
} from "../src/scenarios/bracket-path.js";
import type { ProcessResult } from "../src/process.js";
import type { TurboRunEvidence } from "../src/turbo.js";

function processResult(overrides: Partial<ProcessResult> = {}): ProcessResult {
  return {
    command: "turbo",
    args: [],
    exitCode: 0,
    signal: null,
    stdout: "",
    stderr: "",
    timedOut: false,
    durationMs: 1,
    ...overrides,
  };
}

function run(status: "HIT" | "MISS", hash: string): TurboRunEvidence {
  return {
    process: processResult(),
    task: { taskId: "app#build", hash, cache: { local: status === "HIT", remote: false, status } },
  };
}

function evidence(second: TurboRunEvidence): BracketExperimentEvidence {
  return {
    inputPattern: "src/[id]/page.js",
    first: run("MISS", "old-hash"),
    second,
    baseline: run("MISS", "new-hash"),
    fingerprints: { v1: "v1", v2: "v2", cachedOutput: "v1", baselineOutput: "v2" },
  };
}

describe("bracket-path classification", () => {
  it("detects a stale local hit with mismatched baseline output", () => {
    expect(classifyBracketExperiment(evidence(run("HIT", "old-hash")))).toBe("STALE_HIT");
  });

  it("passes the normal control when input changes cause a miss and correct output", () => {
    const control = evidence(run("MISS", "new-hash"));
    control.fingerprints = { ...control.fingerprints!, cachedOutput: "v2" };
    expect(classifyBracketExperiment(control)).toBe("PASS");
  });

  it("is inconclusive without cache-hit evidence", () => {
    expect(classifyBracketExperiment(evidence(run("MISS", "old-hash")))).toBe("INCONCLUSIVE");
  });

  it.each([
    ["failed baseline", processResult({ exitCode: 1 })],
    ["timeout", processResult({ exitCode: null, timedOut: true })],
  ])("reports environment error for a %s", (_name, failedProcess) => {
    const value = evidence(run("HIT", "old-hash"));
    value.baseline = { process: failedProcess };
    expect(classifyBracketExperiment(value)).toBe("ENVIRONMENT_ERROR");
  });
});
