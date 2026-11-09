import { access, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { runProcess } from "../src/process.js";
import type { VerificationConfig } from "../src/verification/config.js";
import {
  assertCleanGitProject,
  assertContainedLinkTarget,
  assertOwnedPath,
  createVerificationIsolation,
} from "../src/verification/isolation.js";
import { installEnvironment, probePackageManager } from "../src/verification/package-manager.js";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, {
    recursive: true, force: true, maxRetries: 5, retryDelay: 100,
  })));
});

async function gitCommit(root: string): Promise<void> {
  for (const args of [["add", "."], ["commit", "-qm", "fixture update"]]) {
    const result = await runProcess("git", args, { cwd: root, timeoutMs: 10_000 });
    if (result.exitCode !== 0) throw new Error(result.stderr);
  }
}

async function project(): Promise<string> {
  const root = await mkdtemp(join(process.cwd(), ".cachetrust-isolation-"));
  roots.push(root);
  await mkdir(join(root, "src"));
  await writeFile(join(root, "src", "input.txt"), "original\n");
  await writeFile(join(root, "lock.yaml"), "lockfileVersion: 1\n");
  await writeFile(join(root, "install.mjs"), [
    'import { mkdir, writeFile } from "node:fs/promises";',
    'await mkdir("node_modules", { recursive: true });',
    'await writeFile("node_modules/installed.txt", "isolated\\n");',
  ].join("\n"));
  for (const args of [
    ["init", "-q"],
    ["config", "user.email", "test@example.invalid"],
    ["config", "user.name", "Test"],
    ["add", "."],
    ["commit", "-qm", "fixture"],
  ]) {
    const result = await runProcess("git", args, { cwd: root, timeoutMs: 10_000 });
    if (result.exitCode !== 0) throw new Error(result.stderr);
  }
  return root;
}

function config(root: string): VerificationConfig {
  return {
    schemaVersion: "1",
    id: "isolation",
    projectRoot: root,
    evidenceFile: join(root, "..", "evidence.json"),
    install: {
      command: process.execPath,
      commandArgs: ["install.mjs"],
      versionArgs: ["--version"],
      args: ["--frozen-lockfile"],
      packageManager: "fixture",
      packageManagerVersion: "1",
      lockfiles: ["lock.yaml"],
      timeoutMs: 10_000,
    },
    turbo: { command: "turbo", task: "build", version: "1", timeoutMs: 10_000 },
    tasks: [{ id: "app#build", expectedAfterMutation: "HIT" }],
    outputs: [{ taskId: "app#build", include: ["dist/**"] }],
    mutation: { kind: "none" },
  };
}

describe("verification isolation", () => {
  it("rejects a dirty repository before workspace setup", async () => {
    const root = await project();
    await writeFile(join(root, "untracked.txt"), "dirty");
    await expect(assertCleanGitProject(root)).rejects.toMatchObject({ reasonCode: "DIRTY_REPOSITORY" });
    await expect(access(join(root, "untracked.txt"))).resolves.toBeUndefined();
  });

  it("installs independently and leaves the clean source unchanged", async () => {
    const root = await project();
    const isolation = await createVerificationIsolation(config(root));
    roots.push(isolation.root);
    expect(isolation.workspaces.map((workspace) => workspace.cache)).toHaveLength(3);
    for (const workspace of isolation.workspaces) {
      await expect(readFile(join(workspace.project, "node_modules", "installed.txt"), "utf8"))
        .resolves.toBe("isolated\n");
    }
    await writeFile(join(isolation.workspaces[0].project, "src", "input.txt"), "changed\n");
    expect(await readFile(join(root, "src", "input.txt"), "utf8")).toBe("original\n");
    expect(await readFile(join(isolation.workspaces[1].project, "src", "input.txt"), "utf8"))
      .toBe("original\n");
    await isolation.cleanup();
    await expect(access(isolation.root)).rejects.toThrow();
    expect(await readFile(join(root, "src", "input.txt"), "utf8")).toBe("original\n");
  });

  it("uses one inherited and overridden environment for the probe and all workspaces", async () => {
    const root = await project();
    await writeFile(join(root, "install.mjs"), [
      'import { mkdir, writeFile } from "node:fs/promises";',
      'if (process.env.CACHETRUST_OVERRIDE !== "configured") process.exit(41);',
      'if (process.env.CACHETRUST_INHERITED !== "inherited") process.exit(42);',
      'if (process.argv.includes("--version")) console.log("1");',
      'else {',
      '  await mkdir("node_modules", { recursive: true });',
      '  await writeFile("node_modules/environment.json", JSON.stringify({',
      '    override: process.env.CACHETRUST_OVERRIDE, inherited: process.env.CACHETRUST_INHERITED',
      '  }));',
      '}',
    ].join("\n"));
    await gitCommit(root);
    const value = config(root);
    value.install.environment = { CACHETRUST_OVERRIDE: "configured" };
    const previous = process.env.CACHETRUST_INHERITED;
    process.env.CACHETRUST_INHERITED = "inherited";
    try {
      const probe = await probePackageManager(value);
      process.env.CACHETRUST_INHERITED = "changed-after-probe";
      const isolation = await createVerificationIsolation(value, probe.install);
      roots.push(isolation.root);
      for (const workspace of isolation.workspaces) {
        await expect(readFile(join(workspace.project, "node_modules", "environment.json"), "utf8"))
          .resolves.toBe('{"override":"configured","inherited":"inherited"}');
      }
    } finally {
      if (previous === undefined) delete process.env.CACHETRUST_INHERITED;
      else process.env.CACHETRUST_INHERITED = previous;
    }
  });

  it("merges Windows environment names case-insensitively", () => {
    const value = config("C:\\project");
    value.install.environment = { PATH: "configured" };
    expect(installEnvironment(value, { Path: "inherited", KEEP: "yes" }, "win32"))
      .toEqual({ PATH: "configured", KEEP: "yes" });
  });

  it("rejects traversal and cleanup targets outside the owned root", () => {
    expect(() => assertOwnedPath("C:\\owned", "C:\\outside")).toThrow("escapes owned root");
    expect(() => assertOwnedPath("/owned", "/owned/../outside")).toThrow("escapes owned root");
    expect(() => assertContainedLinkTarget("C:\\owned", "C:\\outside\\package"))
      .toThrow("escapes its workspace");
  });

  it("terminates a cancelled install and removes its partial workspace", async () => {
    const root = await project();
    const value = config(root);
    value.install.command = process.execPath;
    value.install.commandArgs = ["-e", "setInterval(() => {}, 1000)", "--"];
    value.install.args = ["--frozen-lockfile"];
    const controller = new AbortController();
    setTimeout(() => controller.abort(), 100);
    await expect(createVerificationIsolation(value, undefined, controller.signal))
      .rejects.toMatchObject({ reasonCode: "CANCELLED" });
    expect((await readdir(join(root, ".."))).filter((name) => name.startsWith(".cachetrust-verify-")))
      .toEqual([]);
  });
});
