import { describe, expect, it } from "vitest";
import { parseVerificationSummary, validateOutputCoverage } from "../src/verification/turbo-runner.js";
import type { VerificationConfig } from "../src/verification/config.js";

function summary(status: "HIT" | "MISS") {
  return {
    turboVersion: "2.10.12",
    tasks: [{
      taskId: "app#build", hash: "abc", directory: "apps\\app",
      cache: { status, local: status === "HIT", remote: false },
      outputs: ["dist/**"], excludedOutputs: ["dist/cache/**"],
    }],
  };
}

describe("Turbo verification evidence", () => {
  it.each(["HIT", "MISS"] as const)("parses genuine %s evidence", (status) => {
    expect(parseVerificationSummary(summary(status), ["app#build"]).tasks[0]).toMatchObject({
      id: "app#build", hash: "abc", cache: { status, local: status === "HIT", remote: false },
      outputs: ["apps/app/dist/**"], excludedOutputs: ["apps/app/dist/cache/**"],
    });
  });

  it("rejects missing selected task cache evidence", () => {
    expect(() => parseVerificationSummary(summary("HIT"), ["missing#build"]))
      .toThrow("Selected task missing");
  });

  it("fails output coverage closed", () => {
    const tasks = parseVerificationSummary(summary("MISS"), ["app#build"]).tasks;
    const config = {
      tasks: [{ id: "app#build", expectedAfterMutation: "MISS" }],
      outputs: [{ taskId: "app#build", include: ["apps/app/partial/**"], exclude: ["apps/app/dist/cache/**"] }],
    } as VerificationConfig;
    expect(validateOutputCoverage(config, tasks)).toMatchObject({ valid: false });
  });
});
