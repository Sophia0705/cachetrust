import { execPath } from "node:process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { runProcess } from "../src/process.js";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

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

  it("flushes output and lifecycle before the process closes", async () => {
    const root = await mkdtemp(join(tmpdir(), "cachetrust-process-durable-"));
    roots.push(root);
    const files = {
      stdoutPath: join(root, "stdout.log"),
      stderrPath: join(root, "stderr.log"),
      lifecyclePath: join(root, "lifecycle.jsonl"),
    };
    const controller = new AbortController();
    let settled = false;
    const run = runProcess(execPath, [
      "-e",
      "process.stdout.write('partial'); setInterval(() => {}, 1000)",
    ], { signal: controller.signal, durableFiles: files }).finally(() => { settled = true; });

    for (let attempt = 0; attempt < 50; attempt += 1) {
      if ((await readFile(files.stdoutPath, "utf8").catch(() => "")) === "partial") break;
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    expect(await readFile(files.stdoutPath, "utf8")).toBe("partial");
    expect(settled).toBe(false);
    const beforeAbort = (await readFile(files.lifecyclePath, "utf8"))
      .trim().split(/\r?\n/).map((line) => JSON.parse(line) as { event: string });
    expect(beforeAbort.map((entry) => entry.event)).toEqual(["controller-start", "spawn"]);

    controller.abort();
    const result = await run;
    expect(result.stdout).toBe("partial");
    const events = (await readFile(files.lifecyclePath, "utf8"))
      .trim().split(/\r?\n/).map((line) => JSON.parse(line) as { event: string });
    expect(events.map((entry) => entry.event)).toEqual([
      "controller-start", "spawn", "abort-fired", "termination-requested", "exit", "close",
    ]);
  });

  it("records nonzero and timeout lifecycle outcomes", async () => {
    const root = await mkdtemp(join(tmpdir(), "cachetrust-process-outcomes-"));
    roots.push(root);
    const files = (id: string) => ({
      stdoutPath: join(root, `${id}.stdout.log`),
      stderrPath: join(root, `${id}.stderr.log`),
      lifecyclePath: join(root, `${id}.lifecycle.jsonl`),
    });
    const nonzeroFiles = files("nonzero");
    const nonzero = await runProcess(execPath, ["-e", "process.stderr.write('bad'); process.exit(7)"], {
      durableFiles: nonzeroFiles,
    });
    expect(nonzero.exitCode).toBe(7);
    expect(await readFile(nonzeroFiles.stderrPath, "utf8")).toBe("bad");
    const nonzeroEvents = (await readFile(nonzeroFiles.lifecyclePath, "utf8"))
      .trim().split(/\r?\n/).map((line) => JSON.parse(line) as { event: string });
    expect(nonzeroEvents.at(-1)?.event).toBe("close");

    const timeoutFiles = files("timeout");
    const timeout = await runProcess(execPath, ["-e", "setInterval(() => {}, 1000)"], {
      timeoutMs: 100,
      durableFiles: timeoutFiles,
    });
    expect(timeout.timedOut).toBe(true);
    const timeoutEvents = (await readFile(timeoutFiles.lifecyclePath, "utf8"))
      .trim().split(/\r?\n/).map((line) => JSON.parse(line) as { event: string });
    expect(timeoutEvents.map((entry) => entry.event)).toContain("timeout-fired");
    expect(timeoutEvents.at(-1)?.event).toBe("close");
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
