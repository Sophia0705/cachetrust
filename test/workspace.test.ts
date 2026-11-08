import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { mkdtemp, rm } from "node:fs/promises";
import { afterEach, describe, expect, it } from "vitest";
import { createTemporaryWorkspace, withTemporaryWorkspace } from "../src/workspace.js";

const testRoots: string[] = [];
afterEach(async () => {
  for (const path of testRoots.splice(0).sort((left, right) => right.length - left.length)) {
    await rm(path, { recursive: true, force: true });
  }
});

async function fixture(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "cachetrust-test-"));
  testRoots.push(root);
  const path = join(root, "fixture[id]");
  await mkdir(path);
  await writeFile(join(path, "value.txt"), "original");
  return path;
}

describe("temporary workspace", () => {
  it("copies a special-character path without modifying the source", async () => {
    const source = await fixture();
    const workspace = await createTemporaryWorkspace(source);
    testRoots.push(workspace.root);
    await expect(access(workspace.cache)).resolves.toBeUndefined();
    await writeFile(join(workspace.fixture, "value.txt"), "changed");

    expect(await readFile(join(source, "value.txt"), "utf8")).toBe("original");
  });

  it("cleans the workspace after use", async () => {
    const source = await fixture();
    let workspaceRoot = "";
    await withTemporaryWorkspace(source, async (workspace) => {
      workspaceRoot = workspace.root;
      await access(workspaceRoot);
    });

    await expect(access(workspaceRoot)).rejects.toThrow();
  });
});
