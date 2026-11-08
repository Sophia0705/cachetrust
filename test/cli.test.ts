import { describe, expect, it, vi } from "vitest";
import { createCli } from "../src/cli.js";

function io() {
  return { out: vi.fn(), error: vi.fn() };
}

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
});
