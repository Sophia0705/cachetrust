import { spawn } from "node:child_process";

export interface ProcessOptions {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  timeoutMs?: number;
}

export interface ProcessResult {
  command: string;
  args: readonly string[];
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  durationMs: number;
}

export function runProcess(
  command: string,
  args: readonly string[] = [],
  options: ProcessOptions = {},
): Promise<ProcessResult> {
  if (options.timeoutMs !== undefined && options.timeoutMs <= 0) {
    throw new RangeError("timeoutMs must be greater than zero");
  }

  const startedAt = performance.now();

  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: options.env,
      shell: false,
      windowsHide: true,
    });
    let stdout = "";
    let stderr = "";
    let timedOut = false;

    child.stdout.setEncoding("utf8").on("data", (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.setEncoding("utf8").on("data", (chunk: string) => {
      stderr += chunk;
    });
    const timer = options.timeoutMs === undefined
      ? undefined
      : setTimeout(() => {
          timedOut = true;
          if (process.platform === "win32" && child.pid !== undefined) {
            const killer = spawn("taskkill", ["/pid", String(child.pid), "/T", "/F"], {
              windowsHide: true,
            });
            const fallback = setTimeout(() => child.kill(), 250);
            killer.once("error", () => child.kill());
            killer.once("close", () => {
              clearTimeout(fallback);
              child.kill();
            });
          } else {
            child.kill();
          }
        }, options.timeoutMs);

    child.once("error", (error) => {
      if (timer !== undefined) clearTimeout(timer);
      reject(error);
    });

    child.once("close", (exitCode, signal) => {
      if (timer !== undefined) clearTimeout(timer);
      resolve({
        command,
        args,
        exitCode,
        signal,
        stdout,
        stderr,
        timedOut,
        durationMs: performance.now() - startedAt,
      });
    });
  });
}
