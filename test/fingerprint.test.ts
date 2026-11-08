import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { fingerprintFile } from "../src/fingerprint.js";

describe("fingerprintFile", () => {
  it("changes when file contents change", async () => {
    const root = await mkdtemp(join(tmpdir(), "cachetrust-hash-"));
    const file = join(root, "artifact[id].txt");
    try {
      await writeFile(file, "before");
      const before = await fingerprintFile(file);
      await writeFile(file, "after");
      const after = await fingerprintFile(file);
      expect(before).toMatch(/^[a-f0-9]{64}$/);
      expect(after).not.toBe(before);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
