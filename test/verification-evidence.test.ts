import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { ProcessResult } from "../src/process.js";
import { evidenceRun, writeEvidence, type VerificationEvidence } from "../src/verification/evidence.js";

function processResult(): ProcessResult {
  return {
    command: "turbo",
    args: ["run", "build", "--token", "secret"],
    exitCode: 0,
    signal: null,
    stdout: "build output",
    stderr: "",
    timedOut: false,
    durationMs: 10,
  };
}

describe("verification evidence", () => {
  it("redacts command secrets and stores log digests instead of content", () => {
    const run = evidenceRun("v1", { process: processResult(), tasks: [] });
    expect(run.command).toEqual(["turbo", "run", "build", "--token", "<REDACTED>"]);
    expect(run.stdout).toMatchObject({ bytes: 12, retained: false });
    expect(JSON.stringify(run)).not.toContain("build output");
  });

  it("writes versioned JSON atomically", async () => {
    const root = await mkdtemp(join(process.cwd(), ".cachetrust-evidence-"));
    const path = join(root, "nested", "evidence.json");
    const evidence = {
      schemaVersion: "cachetrust.verification/1",
      cachetrustVersion: "0.1.0",
      caseId: "test",
      startedAt: "2026-01-01T00:00:00.000Z",
      finishedAt: "2026-01-01T00:00:01.000Z",
      environment: { os: "win32", arch: "x64", node: "v24", packageManager: "pnpm 11", turbo: "2" },
      target: { projectLabel: "target", commit: "abc", dirty: false },
      config: { task: "build", packages: [], tasks: [], outputs: [], mutationKind: "none" },
      isolation: {
        strategy: "independent-frozen-install", workspaces: ["cache", "baseline-a", "baseline-b"],
        caches: ["cache/shared", "baseline-a/empty", "baseline-b/empty"],
        remoteCacheDisabled: true, lockfileSha256: {},
      },
      installs: [],
      runs: [],
      verdict: { status: "PASS", reasonCodes: [], implicatedTasks: [], explanation: "test" },
      injectedFault: false,
      limitations: [],
    } as VerificationEvidence;
    try {
      await writeEvidence(path, evidence);
      expect(JSON.parse(await readFile(path, "utf8"))).toEqual(evidence);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
