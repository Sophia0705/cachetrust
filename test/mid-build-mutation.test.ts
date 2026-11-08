import { describe, expect, it } from "vitest";
import type { ProcessResult } from "../src/process.js";
import {
  classifyMutation,
  type MutationEvidence,
} from "../src/scenarios/mid-build-mutation.js";
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

function run(status: "HIT" | "MISS", hash: string, process = processResult()): TurboRunEvidence {
  return {
    process,
    task: { taskId: "app#build", hash, cache: { local: status === "HIT", remote: false, status } },
  };
}

function evidence(overrides: Partial<MutationEvidence> = {}): MutationEvidence {
  return {
    mutationRun: run("MISS", "v2-hash"),
    replayRun: run("HIT", "v2-hash"),
    baselineRun: run("MISS", "baseline-hash"),
    fingerprints: {
      before: "v2",
      afterMutation: "v3",
      afterRevert: "v2",
      mutationOutput: "v3-output",
      replayOutput: "v3-output",
      baselineOutput: "v2-output",
    },
    ...overrides,
  };
}

describe("mid-build-mutation classification", () => {
  it("reports an unsafe save only with a local replay hit and mismatched baseline", () => {
    expect(classifyMutation(evidence())).toBe("UNSAFE_SAVE");
  });

  it("passes when replay and baseline outputs agree", () => {
    const value = evidence();
    value.fingerprints!.replayOutput = "v2-output";
    expect(classifyMutation(value)).toBe("PASS");
  });

  it("is inconclusive when required cache evidence is missing", () => {
    expect(classifyMutation(evidence({ replayRun: { process: processResult() } }))).toBe("INCONCLUSIVE");
  });

  it("reports a synchronization failure as an environment error", () => {
    expect(classifyMutation(evidence({ synchronizationError: "ready marker missing" })))
      .toBe("ENVIRONMENT_ERROR");
  });

  it("reports a timeout as an environment error", () => {
    expect(classifyMutation(evidence({
      mutationRun: run("MISS", "v2-hash", processResult({ timedOut: true, exitCode: null })),
    }))).toBe("ENVIRONMENT_ERROR");
  });

  it("reports a failed baseline build as an environment error", () => {
    expect(classifyMutation(evidence({
      baselineRun: run("MISS", "baseline-hash", processResult({ exitCode: 1 })),
    }))).toBe("ENVIRONMENT_ERROR");
  });
});
