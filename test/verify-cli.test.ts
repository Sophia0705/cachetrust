import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createCli, type CliServices } from "../src/cli.js";
import { loadVerificationConfig } from "../src/verification/config-file.js";
import type { VerificationEvidence } from "../src/verification/evidence.js";

const roots: string[] = [];
afterEach(async () => {
  process.exitCode = undefined;
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

function io() {
  return { out: vi.fn(), error: vi.fn() };
}

function rawConfig(root: string) {
  return {
    schemaVersion: "1",
    id: "cli-test",
    projectRoot: "project",
    evidenceFile: "evidence.json",
    install: {
      command: "node", commandArgs: ["pm.mjs"], versionArgs: ["--version"],
      args: ["install", "--frozen-lockfile"], packageManager: "fixture",
      packageManagerVersion: "1.0.0", lockfiles: ["lock.yaml"], timeoutMs: 1_000,
    },
    turbo: { command: "node", args: ["turbo.mjs"], task: "build", version: "1", timeoutMs: 1_000 },
    tasks: [{ id: "app#build", expectedAfterMutation: "HIT" }],
    outputs: [{ taskId: "app#build", include: ["dist/**"] }],
    mutation: { kind: "none" },
  };
}

async function configFile(value?: unknown): Promise<string> {
  const root = await mkdtemp(join(process.cwd(), ".cachetrust-cli-"));
  roots.push(root);
  await mkdir(join(root, "project"));
  const path = join(root, "cachetrust.config.json");
  await writeFile(path, typeof value === "string" ? value : JSON.stringify(value ?? rawConfig(root)));
  return path;
}

function evidence(
  status: "PASS" | "MISMATCH" | "INCONCLUSIVE" | "ENVIRONMENT_ERROR",
  reason: string = status,
): VerificationEvidence {
  return {
    schemaVersion: "cachetrust.verification/1", cachetrustVersion: "0.1.0", caseId: "cli-test",
    startedAt: "2026-01-01T00:00:00.000Z", finishedAt: "2026-01-01T00:00:01.000Z",
    environment: {
      os: "win32", arch: "x64", node: "v24",
      packageManager: { name: "fixture", expectedVersion: "1", observedVersion: "1" }, turbo: "1",
    },
    target: { projectLabel: "target", commit: "abc", dirty: false },
    config: {
      task: "build", packages: [], tasks: [{ id: "app#build", expectedAfterMutation: "HIT" }],
      outputs: [{ taskId: "app#build", include: ["dist/**"] }], mutationKind: "none",
    },
    installs: [],
    isolation: {
      strategy: "independent-frozen-install", workspaces: ["cache", "baseline-a", "baseline-b"],
      caches: ["cache/shared", "baseline-a/empty", "baseline-b/empty"],
      remoteCacheDisabled: true, lockfileSha256: {},
    },
    runs: [], comparisons: {
      baselineStable: true, cacheMatchesBaseline: status === "PASS", functionalChecks: [],
    },
    verdict: { status, reasonCodes: [reason], implicatedTasks: [], explanation: reason },
    injectedFault: false, limitations: [],
  };
}

function services(result: VerificationEvidence): CliServices {
  return { loadConfig: loadVerificationConfig, verify: async () => result };
}

describe("verify CLI", () => {
  it("shows verify help", async () => {
    const output = io();
    const program = createCli([], output);
    program.commands.find((command) => command.name() === "verify")!.exitOverride();
    await expect(program.parseAsync([
      "node", "cachetrust", "verify", "--help",
    ])).rejects.toMatchObject({ code: "commander.helpDisplayed" });
    expect(output.out.mock.calls.flat().join("\n")).toContain("--config <path>");
  });

  it("requires --config", async () => {
    const output = io();
    const program = createCli([], output);
    program.commands.find((command) => command.name() === "verify")!.exitOverride();
    await expect(program.parseAsync([
      "node", "cachetrust", "verify",
    ])).rejects.toMatchObject({ code: "commander.missingMandatoryOptionValue" });
  });

  it("accepts a valid JSON configuration and prints a concise summary", async () => {
    const path = await configFile();
    const output = io();
    await createCli([], output, services(evidence("PASS", "CORRECT_REUSE"))).exitOverride()
      .parseAsync(["node", "cachetrust", "verify", "--config", path]);
    expect(process.exitCode).toBe(0);
    expect(output.out).toHaveBeenCalledWith("VERDICT PASS: CORRECT_REUSE");
    expect(output.out.mock.calls.flat().join("\n")).toMatch(/EVIDENCE .*evidence\.json/);
  });

  it("rejects missing, malformed, unsupported, and unsafe configurations", async () => {
    const missingOutput = io();
    await createCli([], missingOutput, services(evidence("PASS"))).exitOverride()
      .parseAsync(["node", "cachetrust", "verify", "--config", "missing.json"]);
    expect(process.exitCode).toBe(3);
    expect(missingOutput.error.mock.calls.flat().join("\n")).toContain("CONFIG_UNREADABLE");
    process.exitCode = undefined;

    const malformed = await configFile("{");
    const malformedOutput = io();
    await createCli([], malformedOutput, services(evidence("PASS"))).exitOverride()
      .parseAsync(["node", "cachetrust", "verify", "--config", malformed]);
    expect(process.exitCode).toBe(2);
    expect(malformedOutput.error.mock.calls.flat().join("\n")).toContain("MALFORMED_JSON");
    process.exitCode = undefined;

    const unsupportedValue = rawConfig("");
    unsupportedValue.schemaVersion = "2";
    const unsupported = await configFile(unsupportedValue);
    await createCli([], io(), services(evidence("PASS"))).exitOverride()
      .parseAsync(["node", "cachetrust", "verify", "--config", unsupported]);
    expect(process.exitCode).toBe(2);
    process.exitCode = undefined;

    const unsafeValue = rawConfig("") as Record<string, any>;
    unsafeValue.mutation = {
      kind: "replace-file", path: "../outside", replacementFile: "replacement.txt",
      expectedBeforeSha256: "before", expectedAfterSha256: "after",
    };
    const unsafe = await configFile(unsafeValue);
    await createCli([], io(), services(evidence("PASS"))).exitOverride()
      .parseAsync(["node", "cachetrust", "verify", "--config", unsafe]);
    expect(process.exitCode).toBe(2);
  });

  it.each([
    ["PASS", 0], ["MISMATCH", 1], ["INCONCLUSIVE", 2], ["ENVIRONMENT_ERROR", 3],
  ] as const)("maps %s to exit code %i", async (status, exitCode) => {
    const path = await configFile();
    await createCli([], io(), services(evidence(status))).exitOverride()
      .parseAsync(["node", "cachetrust", "verify", "--config", path]);
    expect(process.exitCode).toBe(exitCode);
  });

  it("does not report evidence success when verification or evidence writing fails", async () => {
    const path = await configFile();
    const output = io();
    const failing: CliServices = {
      loadConfig: loadVerificationConfig,
      verify: async () => { throw new Error("evidence destination already exists"); },
    };
    await createCli([], output, failing).exitOverride()
      .parseAsync(["node", "cachetrust", "verify", "--config", path]);
    expect(process.exitCode).toBe(3);
    expect(output.out.mock.calls.flat().join("\n")).not.toContain("EVIDENCE");
  });

  it("propagates Ctrl+C and never reports PASS", async () => {
    const path = await configFile();
    const output = io();
    const cancelling: CliServices = {
      loadConfig: loadVerificationConfig,
      verify: async (_config, options) => {
        await new Promise<void>((resolve) => {
          options?.signal?.addEventListener("abort", () => resolve(), { once: true });
        });
        return evidence("ENVIRONMENT_ERROR", "CANCELLED");
      },
    };
    const run = createCli([], output, cancelling).exitOverride()
      .parseAsync(["node", "cachetrust", "verify", "--config", path]);
    setTimeout(() => process.emit("SIGINT"), 20);
    await run;
    expect(process.exitCode).toBe(3);
    expect(output.out).toHaveBeenCalledWith("VERDICT ENVIRONMENT_ERROR: CANCELLED");
    expect(output.out.mock.calls.flat().join("\n")).not.toContain("VERDICT PASS");
  });
});
