import { link, mkdir, mkdtemp, rm, symlink, truncate, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { runProcess } from "../src/process.js";
import { measurePhysicalStorage } from "../src/verification/physical-storage.js";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("physical storage measurement", () => {
  it("deduplicates hardlinks, skips junctions, and is repeatable", async () => {
    const parent = await mkdtemp(join(tmpdir(), "cachetrust-storage-"));
    roots.push(parent);
    const root = join(parent, "owned");
    const outside = join(parent, "outside");
    await mkdir(root);
    await mkdir(outside);
    const original = join(root, "original.bin");
    await writeFile(original, Buffer.alloc(8_192, 1));
    await link(original, join(root, "hardlink.bin"));
    await writeFile(join(outside, "excluded.bin"), Buffer.alloc(32_768, 2));
    const junction = join(root, "junction");
    try {
      await symlink(outside, junction, "junction");
    } catch (error) {
      if (process.platform !== "win32") throw error;
      const created = await runProcess(process.env.ComSpec ?? "cmd.exe", [
        "/d", "/c", "mklink", "/J", junction, outside,
      ]);
      if (created.exitCode !== 0) throw new Error(created.stderr || created.stdout);
    }

    const first = await measurePhysicalStorage(root);
    const second = await measurePhysicalStorage(root);
    expect(first).toEqual(second);
    expect(first.files).toBe(1);
    expect(first.duplicateFileIds).toBe(1);
    expect(first.skippedLinks).toBe(1);
    expect(first.logicalBytes).toBe(8_192n);
    expect(first.allocatedBytes).toBeGreaterThan(0n);
  });

  it.runIf(process.platform === "win32")("reports allocated bytes separately for a sparse file", async () => {
    const root = await mkdtemp(join(tmpdir(), "cachetrust-storage-sparse-"));
    roots.push(root);
    const sparse = join(root, "sparse.bin");
    await writeFile(sparse, "x");
    await truncate(sparse, 16 * 1024 * 1024);
    const flagged = await runProcess("fsutil.exe", ["sparse", "setflag", sparse]);
    if (flagged.exitCode !== 0) throw new Error(flagged.stderr || flagged.stdout);
    const deallocated = await runProcess("fsutil.exe", [
      "sparse", "setrange", sparse, "4096", String(16 * 1024 * 1024 - 4096),
    ]);
    if (deallocated.exitCode !== 0) throw new Error(deallocated.stderr || deallocated.stdout);

    const measured = await measurePhysicalStorage(root);
    expect(measured.logicalBytes).toBe(16n * 1024n * 1024n);
    expect(measured.allocatedBytes).toBeLessThan(measured.logicalBytes);
  });

  it("fails instead of returning a partial value for an unreadable root", async () => {
    await expect(measurePhysicalStorage(join(tmpdir(), "cachetrust-storage-missing"))).rejects.toThrow();
  });
});
