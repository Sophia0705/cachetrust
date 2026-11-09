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

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, {
    recursive: true, force: true, maxRetries: 5, retryDelay: 100,
  })));
});

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
      args: ["install.mjs", "--frozen-lockfile"],
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
    value.install.args = ["-e", "setInterval(() => {}, 1000)", "--", "--frozen-lockfile"];
    const controller = new AbortController();
    setTimeout(() => controller.abort(), 100);
    await expect(createVerificationIsolation(value, controller.signal))
      .rejects.toMatchObject({ reasonCode: "CANCELLED" });
    expect((await readdir(join(root, ".."))).filter((name) => name.startsWith(".cachetrust-verify-")))
      .toEqual([]);
  });
});
