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

  it("rejects a spawn error without leaving the timeout active", async () => {
    await expect(runProcess("cachetrust-command-that-does-not-exist", [], { timeoutMs: 2_000 }))
      .rejects.toMatchObject({ code: "ENOENT" });
  });

  it("terminates a process after the timeout", async () => {
    const result = await runProcess(execPath, ["-e", "setInterval(() => {}, 1000)"], {
      timeoutMs: 100,
    });
    expect(result.timedOut).toBe(true);
    expect(result.exitCode).not.toBe(0);
  });

  it("terminates a process when cancelled", async () => {
    const controller = new AbortController();
    const run = runProcess(execPath, ["-e", "setInterval(() => {}, 1000)"], {
      signal: controller.signal,
    });
    setTimeout(() => controller.abort(), 100);
    const result = await run;
    expect(result.timedOut).toBe(false);
    expect(result.exitCode).not.toBe(0);
  });

  it.runIf(process.platform === "win32")("terminates the Windows process tree", async () => {
    const result = await runProcess(execPath, [
      "-e",
      `const { spawn } = require("node:child_process");
       const child = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { stdio: "inherit" });
       console.log(child.pid);
       setInterval(() => {}, 1000);`,
    ], { timeoutMs: 250 });

    const childPid = Number(result.stdout.trim());
    expect(result.timedOut).toBe(true);
    expect(childPid).toBeGreaterThan(0);
    expect(() => process.kill(childPid, 0)).toThrow();
  }, 5_000);
});
