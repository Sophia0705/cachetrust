import { spawn } from "node:child_process";
import { closeSync, fsyncSync, openSync, writeSync } from "node:fs";

export interface DurableProcessFiles {
  stdoutPath: string;
  stderrPath: string;
  lifecyclePath: string;
}

export interface ProcessOptions {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  timeoutMs?: number;
  signal?: AbortSignal;
  durableFiles?: DurableProcessFiles;
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

function openDurableFiles(files: DurableProcessFiles): {
  stdout: number;
  stderr: number;
  lifecycle: number;
} {
  const opened: number[] = [];
  try {
    const stdout = openSync(files.stdoutPath, "wx");
    opened.push(stdout);
    const stderr = openSync(files.stderrPath, "wx");
    opened.push(stderr);
    const lifecycle = openSync(files.lifecyclePath, "wx");
    opened.push(lifecycle);
    return { stdout, stderr, lifecycle };
  } catch (error) {
    for (const handle of opened.reverse()) closeSync(handle);
    throw error;
  }
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
    const handles = options.durableFiles === undefined ? undefined : openDurableFiles(options.durableFiles);
    let handlesClosed = false;
    let durableError: Error | undefined;
    const durableWrite = (handle: number | undefined, value: string): void => {
      if (handle === undefined || handlesClosed) return;
      writeSync(handle, value);
      fsyncSync(handle);
    };
    const lifecycle = (event: string, details: Record<string, unknown> = {}): void => {
      try {
        durableWrite(handles?.lifecycle, `${JSON.stringify({
          event, at: new Date().toISOString(), ...details,
        })}\n`);
      } catch (error) {
        durableError ??= error instanceof Error ? error : new Error(String(error));
      }
    };
    const closeHandles = (): void => {
      if (handles === undefined || handlesClosed) return;
      handlesClosed = true;
      closeSync(handles.stdout);
      closeSync(handles.stderr);
      closeSync(handles.lifecycle);
    };
    lifecycle("controller-start", { controllerPid: process.pid });
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: options.env,
      shell: false,
      windowsHide: true,
    });
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    let terminationStarted = false;
    lifecycle("spawn", { childPid: child.pid ?? null });

    child.stdout.setEncoding("utf8").on("data", (chunk: string) => {
      stdout += chunk;
      try {
        durableWrite(handles?.stdout, chunk);
      } catch (error) {
        durableError = error instanceof Error ? error : new Error(String(error));
        terminate("durable-write-error");
      }
    });
    child.stderr.setEncoding("utf8").on("data", (chunk: string) => {
      stderr += chunk;
      try {
        durableWrite(handles?.stderr, chunk);
      } catch (error) {
        durableError = error instanceof Error ? error : new Error(String(error));
        terminate("durable-write-error");
      }
    });
    const terminate = (reason: "timeout" | "abort" | "durable-write-error") => {
      if (terminationStarted) return;
      terminationStarted = true;
      lifecycle("termination-requested", { reason, childPid: child.pid ?? null });
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
    };
    if (durableError !== undefined) terminate("durable-write-error");
    const timer = options.timeoutMs === undefined ? undefined : setTimeout(() => {
      timedOut = true;
      lifecycle("timeout-fired", { timeoutMs: options.timeoutMs });
      terminate("timeout");
    }, options.timeoutMs);
    const abort = () => {
      lifecycle("abort-fired");
      terminate("abort");
    };
    options.signal?.addEventListener("abort", abort, { once: true });
    if (options.signal?.aborted === true) terminate("abort");

    child.once("error", (error) => {
      lifecycle("error", { code: "code" in error ? error.code : undefined });
      if (timer !== undefined) clearTimeout(timer);
      options.signal?.removeEventListener("abort", abort);
      closeHandles();
      reject(error);
    });

    child.once("exit", (exitCode, signal) => {
      lifecycle("exit", { exitCode, signal });
    });

    child.once("close", (exitCode, signal) => {
      if (timer !== undefined) clearTimeout(timer);
      options.signal?.removeEventListener("abort", abort);
      lifecycle("close", { exitCode, signal, timedOut });
      closeHandles();
      if (durableError !== undefined) {
        reject(durableError);
        return;
      }
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
