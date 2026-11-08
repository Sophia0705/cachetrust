import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createCli, exitCodeFor } from "../src/cli.js";
import type { Scenario, ScenarioResult, ScenarioStatus } from "../src/scenario.js";

function io() {
  return { out: vi.fn(), error: vi.fn() };
}

function result(status: ScenarioStatus): ScenarioResult {
  return { scenarioId: "test", status, message: status, evidence: { stdout: "reproduction log" } };
}

afterEach(() => {
  process.exitCode = undefined;
});

describe("CLI", () => {
  it("lists an empty scenario registry", async () => {
    const output = io();
    await createCli([], output).exitOverride().parseAsync(["node", "cachetrust", "list"]);
    expect(output.out).toHaveBeenCalledWith("No scenarios available.");
  });

  it("rejects invalid arguments", async () => {
    const output = io();
    await expect(
      createCli([], output).exitOverride().parseAsync(["node", "cachetrust", "unknown"]),
    ).rejects.toMatchObject({ code: "commander.unknownCommand" });
  });

  it("rejects an unknown scenario", async () => {
    const output = io();
    await expect(
      createCli([], output).exitOverride().parseAsync([
        "node",
        "cachetrust",
        "run",
        "missing",
        "--fixture",
        ".",
      ]),
    ).rejects.toMatchObject({ code: "cachetrust.unknownScenario" });
  });

  it.each([
    ["PASS", 0],
    ["STALE_HIT", 1],
    ["UNSAFE_SAVE", 1],
    ["INCONCLUSIVE", 2],
    ["ENVIRONMENT_ERROR", 3],
  ] as const)("maps %s to exit code %i", async (status, exitCode) => {
    expect(exitCodeFor([result(status)])).toBe(exitCode);
    const scenario: Scenario = {
      id: "test",
      description: "test scenario",
      run: async () => result(status),
    };
    await createCli([scenario], io()).exitOverride().parseAsync([
      "node", "cachetrust", "run", "test", "--fixture", ".",
    ]);
    expect(process.exitCode).toBe(exitCode);
  });

  it("saves JSON evidence with reproduction logs", async () => {
    const directory = await mkdtemp(join(tmpdir(), "cachetrust-cli-"));
    const evidencePath = join(directory, "nested", "evidence.json");
    const scenario: Scenario = {
      id: "test",
      description: "test scenario",
      run: async () => result("UNSAFE_SAVE"),
    };
    try {
      await createCli([scenario], io()).exitOverride().parseAsync([
        "node", "cachetrust", "run", "test", "--fixture", ".", "--evidence", evidencePath,
      ]);
      expect(JSON.parse(await readFile(evidencePath, "utf8"))).toEqual({
        results: [result("UNSAFE_SAVE")],
      });
      expect(process.exitCode).toBe(1);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
