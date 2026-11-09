import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { runProcess } from "../src/process.js";
import { verifyProject } from "../src/verification/engine.js";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

function sha(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

async function git(root: string, args: string[]): Promise<void> {
  const result = await runProcess("git", args, { cwd: root, timeoutMs: 10_000 });
  if (result.exitCode !== 0) throw new Error(result.stderr);
}

describe("verification engine", () => {
  it("detects confirmed stale local reuse against two isolated baselines", async () => {
    const root = await mkdtemp(join(process.cwd(), ".cachetrust-engine-"));
    roots.push(root);
    const project = join(root, "project");
    const replacement = join(root, "replacement.txt");
    const evidenceFile = join(root, "evidence.json");
    await mkdir(project);
    await writeFile(join(project, "input.txt"), "v1\n");
    await writeFile(replacement, "v2\n");
    await writeFile(join(project, "lock.yaml"), "lockfileVersion: 1\n");
    await writeFile(join(project, "install.mjs"), "// independent fixture install\n");
    await writeFile(join(project, "fake-turbo.mjs"), `
import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
const args = process.argv.slice(2);
const cacheDir = args[args.indexOf("--cache-dir") + 1];
await mkdir(cacheDir, { recursive: true });
await mkdir("dist", { recursive: true });
await mkdir(join(".turbo", "runs"), { recursive: true });
const artifact = join(cacheDir, "artifact.txt");
let hit = true;
try { await copyFile(artifact, join("dist", "output.txt")); }
catch {
  hit = false;
  await writeFile(join("dist", "output.txt"), await readFile("input.txt"));
  await copyFile(join("dist", "output.txt"), artifact);
}
const summary = {
  turboVersion: "1.0.0",
  tasks: [{
    taskId: "app#build", hash: "constant-hash", directory: "",
    cache: { status: hit ? "HIT" : "MISS", local: hit, remote: false },
    outputs: ["dist/**"], excludedOutputs: [],
  }],
};
await writeFile(join(".turbo", "runs", Date.now() + "-" + Math.random() + ".json"), JSON.stringify(summary));
`);
    await git(project, ["init", "-q"]);
    await git(project, ["config", "user.email", "test@example.invalid"]);
    await git(project, ["config", "user.name", "Test"]);
    await git(project, ["add", "."]);
    await git(project, ["commit", "-qm", "fixture"]);

    const evidence = await verifyProject({
      schemaVersion: "1",
      id: "stale-fixture",
      projectRoot: project,
      evidenceFile,
      install: {
        command: process.execPath,
        args: ["install.mjs", "--frozen-lockfile"],
        packageManager: "fixture",
        packageManagerVersion: "1",
        lockfiles: ["lock.yaml"],
        timeoutMs: 10_000,
      },
      turbo: {
        command: process.execPath,
        args: ["fake-turbo.mjs"],
        task: "build",
        version: "1.0.0",
        timeoutMs: 10_000,
      },
      tasks: [{ id: "app#build", expectedAfterMutation: "HIT" }],
      outputs: [{ taskId: "app#build", include: ["dist/**"] }],
      mutation: {
        kind: "replace-file",
        path: "input.txt",
        replacementFile: replacement,
        expectedBeforeSha256: sha("v1\n"),
        expectedAfterSha256: sha("v2\n"),
      },
      functionalChecks: [
        { target: "cache", under: "dist", notContains: "v2" },
        { target: "baseline", under: "dist", contains: "v2" },
      ],
    });

    expect(evidence.verdict).toMatchObject({
      status: "MISMATCH",
      reasonCodes: ["CONFIRMED_STALE_REUSE"],
      implicatedTasks: ["app#build"],
    });
    expect(evidence.comparisons).toMatchObject({ baselineStable: true, cacheMatchesBaseline: false });
    expect(evidence.runs.map((run) => run.id)).toEqual([
      "v1", "cache-v2", "baseline-a-v2", "baseline-b-v2",
    ]);
    expect(await readFile(join(project, "input.txt"), "utf8")).toBe("v1\n");
    expect(JSON.parse(await readFile(evidenceFile, "utf8"))).toMatchObject({
      schemaVersion: "cachetrust.verification/1",
      verdict: { status: "MISMATCH" },
    });
  });
});
