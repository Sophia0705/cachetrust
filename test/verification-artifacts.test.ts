import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { applyMutation, captureMutationOriginal, restoreMutation } from "../src/verification/mutation.js";
import {
  fingerprintOutputs,
  normalizeManifest,
  runFunctionalChecks,
} from "../src/verification/outputs.js";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function fixture(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "cachetrust-verification-"));
  roots.push(root);
  await mkdir(join(root, "src"));
  await mkdir(join(root, "dist"));
  await writeFile(join(root, "src", "input.txt"), "v1\n");
  await writeFile(join(root, "dist", "output.txt"), "value=v1 random=one\n");
  return root;
}

function sha(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

describe("verification mutation and outputs", () => {
  it("supports no-op and verified replacement with restoration", async () => {
    const root = await fixture();
    const replacement = join(root, "replacement.txt");
    await writeFile(replacement, "v2\n");
    expect(await applyMutation(root, { kind: "none" })).toEqual({ kind: "none" });
    const mutation = {
      kind: "replace-file" as const,
      path: "src/input.txt",
      replacementFile: replacement,
      expectedBeforeSha256: sha("v1\n"),
      expectedAfterSha256: sha("v2\n"),
    };
    const original = await captureMutationOriginal(root, mutation);
    await expect(applyMutation(root, mutation)).resolves.toMatchObject({ afterSha256: sha("v2\n") });
    expect(await readFile(join(root, "src", "input.txt"), "utf8")).toBe("v2\n");
    await expect(restoreMutation(root, mutation, original)).resolves.toBe(true);
    expect(await readFile(join(root, "src", "input.txt"), "utf8")).toBe("v1\n");
  });

  it("fails safely on a mutation precondition mismatch", async () => {
    const root = await fixture();
    const replacement = join(root, "replacement.txt");
    await writeFile(replacement, "v2\n");
    await expect(applyMutation(root, {
      kind: "replace-file", path: "src/input.txt", replacementFile: replacement,
      expectedBeforeSha256: "wrong", expectedAfterSha256: sha("v2\n"),
    })).rejects.toThrow("precondition mismatch");
    expect(await readFile(join(root, "src", "input.txt"), "utf8")).toBe("v1\n");
  });

  it("preserves raw fingerprints while applying exact literal normalization", async () => {
    const root = await fixture();
    const outputs = [{ taskId: "app#build", include: ["dist/**"] }];
    const raw = await fingerprintOutputs(root, outputs);
    const normalized = await normalizeManifest(root, raw, {
      id: "test-policy", description: "fixed literal only",
      replaceLiterals: [{ path: "dist/output.txt", search: "random=one", replacement: "random=<id>", reason: "fixture nonce" }],
    });
    expect(raw.entries[0]!.sha256).toBe(sha("value=v1 random=one\n"));
    expect(normalized.sha256).not.toBe(raw.sha256);
    expect(normalized.transformations).toEqual([
      { path: "dist/output.txt", kind: "replace-literal", reason: "fixture nonce" },
    ]);
  });

  it("derives exact text and JSON literals for content and path normalization", async () => {
    const root = await fixture();
    await mkdir(join(root, "dist", "build-one"));
    await writeFile(join(root, "dist", "BUILD_ID"), "build-one\n");
    await writeFile(join(root, "dist", "manifest.json"), JSON.stringify({ preview: { key: "secret-one" } }));
    await writeFile(join(root, "dist", "build-one", "output.txt"), "id=build-one key=secret-one\n");
    await writeFile(join(root, "dist", "escaped.txt"), 'root=C:\\\\work\\\\project\n');
    await writeFile(join(root, "dist", "root.json"), JSON.stringify({ root: "C:\\work\\project" }));
    const raw = await fingerprintOutputs(root, [{ taskId: "app#build", include: ["dist/**"] }]);
    const normalized = await normalizeManifest(root, raw, {
      id: "derived", description: "exact derived values",
      deriveLiterals: [
        {
          sourcePath: "dist/BUILD_ID", target: "dist/**", replacement: "<BUILD_ID>",
          replaceInPath: true, reason: "generated build id",
        },
        {
          sourcePath: "dist/manifest.json", jsonPointer: "/preview/key", target: "dist/**",
          replacement: "<PREVIEW_KEY>", reason: "generated preview key",
        },
        {
          sourcePath: "dist/root.json", jsonPointer: "/root", target: "dist/escaped.txt",
          replacement: "<ROOT>", jsonStringEncoded: true, reason: "isolated root",
        },
      ],
    });
    expect(normalized.entries.some((entry) => entry.path === "dist/<BUILD_ID>/output.txt")).toBe(true);
    const output = normalized.entries.find((entry) => entry.path === "dist/<BUILD_ID>/output.txt");
    expect(output?.sha256).toBe(sha("id=<BUILD_ID> key=<PREVIEW_KEY>\n"));
    const escaped = normalized.entries.find((entry) => entry.path === "dist/escaped.txt");
    expect(escaped?.sha256).toBe(sha("root=<ROOT>\n"));
    expect(normalized.transformations?.some((entry) => entry.kind === "derive-literal")).toBe(true);
  });

  it("checks required presence and global absence", async () => {
    const root = await fixture();
    const checks = await runFunctionalChecks(root, [
      { target: "baseline", under: "dist", contains: "value=v1" },
      { target: "baseline", under: "dist", notContains: "stale-v0" },
      { target: "baseline", under: "dist", notContains: "value=v1" },
    ], "baseline");
    expect(checks.map((check) => check.passed)).toEqual([true, true, false]);
  });
});
