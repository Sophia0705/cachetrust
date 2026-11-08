import { execPath } from "node:process";
import { describe, expect, it } from "vitest";
import { runProcess } from "../src/process.js";

describe("runProcess", () => {
  it("captures a successful process and both output streams", async () => {
    const result = await runProcess(execPath, [
      "-e",
      "process.stdout.write('out'); process.stderr.write('err')",
    ]);

    expect(result).toMatchObject({ exitCode: 0, stdout: "out", stderr: "err", timedOut: false });
  });

  it("captures a non-zero exit code", async () => {
    const result = await runProcess(execPath, ["-e", "process.exit(7)"]);
    expect(result.exitCode).toBe(7);
  });

  it("terminates a process after the timeout", async () => {
    const result = await runProcess(execPath, ["-e", "setInterval(() => {}, 1000)"], {
      timeoutMs: 100,
    });
    expect(result.timedOut).toBe(true);
    expect(result.exitCode).not.toBe(0);
  });
});
