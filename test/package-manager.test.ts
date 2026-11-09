import { access, mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { runProcess } from "../src/process.js";
import type { VerificationConfig } from "../src/verification/config.js";
import { probePackageManager } from "../src/verification/package-manager.js";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function fixture(version = "1.2.3"): Promise<{ root: string; config: VerificationConfig }> {
  const root = await mkdtemp(join(process.cwd(), ".cachetrust-pm-"));
  roots.push(root);
  await writeFile(join(root, "pm.mjs"), `
import { writeFile } from "node:fs/promises";
if (process.argv.includes("--version")) console.log(${JSON.stringify(version)});
else await writeFile("install-ran", "yes");
`);
  return {
    root,
    config: {
      schemaVersion: "1", id: "pm", projectRoot: root, evidenceFile: join(root, "..", "pm-evidence.json"),
      install: {
        command: process.execPath, commandArgs: ["pm.mjs"], versionArgs: ["--version"],
        args: ["install", "--frozen-lockfile"], packageManager: "fixture",
        packageManagerVersion: version, lockfiles: ["lock.yaml"], timeoutMs: 10_000,
      },
      turbo: { command: "turbo", task: "build", version: "1", timeoutMs: 10_000 },
      tasks: [{ id: "app#build", expectedAfterMutation: "HIT" }],
      outputs: [{ taskId: "app#build", include: ["dist/**"] }],
      mutation: { kind: "none" },
    },
  };
}

describe("package-manager probe", () => {
  it("accepts the expected version and reuses the checked executable for install", async () => {
    const { config } = await fixture();
    const probe = await probePackageManager(config);
    expect(probe).toMatchObject({ expectedVersion: "1.2.3", observedVersion: "1.2.3" });
    expect(probe.install.command).toBe(probe.process.command);
    expect(probe.install.args).toEqual(["pm.mjs", "install", "--frozen-lockfile"]);
    expect(probe.install.env).toBeDefined();
  });

  it("rejects a version mismatch before installation", async () => {
    const { config } = await fixture("2.0.0");
    config.install.packageManagerVersion = "1.0.0";
    await expect(probePackageManager(config)).rejects.toMatchObject({
      reasonCode: "PACKAGE_MANAGER_VERSION_MISMATCH",
      observedVersion: "2.0.0",
    });
    await expect(access(join(config.projectRoot, "install-ran"))).rejects.toThrow();
  });

  it("reports a missing executable", async () => {
    const { config } = await fixture();
    config.install.command = "cachetrust-package-manager-does-not-exist";
    await expect(probePackageManager(config)).rejects.toMatchObject({ reasonCode: "PACKAGE_MANAGER_NOT_FOUND" });
  });

  it.runIf(process.platform === "win32")("launches a Windows .cmd package manager consistently", async () => {
    const { root, config } = await fixture();
    const command = join(root, "fixture-pm.cmd");
    await writeFile(command, "@echo off\r\necho 1.2.3\r\n");
    config.install.command = command;
    config.install.commandArgs = [];
    config.install.versionArgs = ["--version"];
    config.install.args = ["--frozen-lockfile"];
    const probe = await probePackageManager(config);
    expect(probe.observedVersion).toBe("1.2.3");
    const install = await runProcess(probe.install.command, probe.install.args, { cwd: root, timeoutMs: 10_000 });
    expect(install.exitCode).toBe(0);
  });
});
