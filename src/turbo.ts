import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { createRequire } from "node:module";
import { runProcess, type ProcessResult } from "./process.js";

const require = createRequire(import.meta.url);
const turboBins = {
  "2.11.8": require.resolve("turbo-2-11-8/bin/turbo"),
  "2.11.9": require.resolve("turbo/bin/turbo"),
} as const;
export type TurboVersion = keyof typeof turboBins;

export interface TurboTaskSummary {
  taskId: string;
  hash: string;
  cache: { local: boolean; remote: boolean; status: "HIT" | "MISS" };
}

export interface TurboRunEvidence {
  process: ProcessResult;
  summaryPath?: string;
  task?: TurboTaskSummary;
  summaryError?: string;
}

function isTaskSummary(value: unknown): value is TurboTaskSummary {
  if (typeof value !== "object" || value === null) return false;
  const task = value as Record<string, unknown>;
  if (typeof task.taskId !== "string" || typeof task.hash !== "string") return false;
  if (typeof task.cache !== "object" || task.cache === null) return false;
  const cache = task.cache as Record<string, unknown>;
  return typeof cache.local === "boolean"
    && typeof cache.remote === "boolean"
    && (cache.status === "HIT" || cache.status === "MISS");
}

export async function runTurbo(
  workspace: string,
  cacheDir: string,
  timeoutMs = 30_000,
  turboVersion: TurboVersion = "2.11.9",
): Promise<TurboRunEvidence> {
  const runsDir = join(workspace, ".turbo", "runs");
  const before = new Set(await readdir(runsDir).catch(() => []));
  const processResult = await runProcess(process.execPath, [
    turboBins[turboVersion],
    "run",
    "build",
    "--cache=local:rw",
    "--cache-dir",
    cacheDir,
    "--summarize",
    "--ui=stream",
    "--no-color",
  ], { cwd: workspace, timeoutMs });

  const created = (await readdir(runsDir).catch(() => [])).filter((name) => !before.has(name));
  if (created.length !== 1) {
    return { process: processResult, summaryError: `Expected one summary file, found ${created.length}` };
  }

  const summaryPath = join(runsDir, created[0]!);
  try {
    const summary = JSON.parse(await readFile(summaryPath, "utf8")) as Record<string, unknown>;
    if (summary.turboVersion !== turboVersion || !Array.isArray(summary.tasks) || summary.tasks.length !== 1) {
      return { process: processResult, summaryPath, summaryError: "Unexpected Turbo summary structure or version" };
    }
    const task = summary.tasks[0];
    if (!isTaskSummary(task)) {
      return { process: processResult, summaryPath, summaryError: "Turbo task summary is missing cache evidence" };
    }
    return { process: processResult, summaryPath, task };
  } catch (error) {
    return { process: processResult, summaryPath, summaryError: String(error) };
  }
}
