import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { runProcess, type ProcessResult } from "../process.js";
import type { VerificationConfig } from "./config.js";

export interface ObservedTurboTask {
  id: string;
  hash: string;
  cache: { status: "HIT" | "MISS"; local: boolean; remote: boolean };
  outputs: string[];
  excludedOutputs: string[];
}

export interface VerificationRun {
  process: ProcessResult;
  summaryPath?: string;
  tasks: ObservedTurboTask[];
  turboVersion?: string;
  error?: string;
}

function portable(path: string): string {
  return path.replaceAll("\\", "/").replace(/^\.\//, "");
}

function taskOutput(directory: string, pattern: string): string {
  const prefix = portable(directory).replace(/\/$/, "");
  const value = portable(pattern);
  return prefix.length === 0 ? value : `${prefix}/${value}`;
}

function parseTask(value: unknown): ObservedTurboTask | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const task = value as Record<string, unknown>;
  const cache = task.cache;
  if (typeof task.taskId !== "string" || typeof task.hash !== "string"
      || typeof task.directory !== "string" || !Array.isArray(task.outputs)
      || !Array.isArray(task.excludedOutputs) || typeof cache !== "object" || cache === null) return undefined;
  const observed = cache as Record<string, unknown>;
  if ((observed.status !== "HIT" && observed.status !== "MISS")
      || typeof observed.local !== "boolean" || typeof observed.remote !== "boolean") return undefined;
  if (task.outputs.some((entry) => typeof entry !== "string")
      || task.excludedOutputs.some((entry) => typeof entry !== "string")) return undefined;
  return {
    id: task.taskId,
    hash: task.hash,
    cache: { status: observed.status, local: observed.local, remote: observed.remote },
    outputs: (task.outputs as string[]).map((pattern) => taskOutput(task.directory as string, pattern)),
    excludedOutputs: (task.excludedOutputs as string[])
      .map((pattern) => taskOutput(task.directory as string, pattern)),
  };
}

export function parseVerificationSummary(
  value: unknown,
  selectedTaskIds: readonly string[],
): { turboVersion: string; tasks: ObservedTurboTask[] } {
  if (typeof value !== "object" || value === null) throw new Error("Unsupported Turbo summary");
  const summary = value as Record<string, unknown>;
  if (!Array.isArray(summary.tasks) || typeof summary.turboVersion !== "string") {
    throw new Error("Unsupported Turbo summary");
  }
  const parsed = summary.tasks.map(parseTask);
  if (parsed.some((task) => task === undefined)) throw new Error("Invalid task cache evidence");
  const tasks = parsed as ObservedTurboTask[];
  const selected = selectedTaskIds.map((id) => tasks.find((task) => task.id === id));
  if (selected.some((task) => task === undefined)) throw new Error("Selected task missing from Turbo summary");
  return { turboVersion: summary.turboVersion, tasks: selected as ObservedTurboTask[] };
}

export async function runVerificationTurbo(
  workspace: string,
  cacheDir: string,
  config: VerificationConfig,
  signal?: AbortSignal,
): Promise<VerificationRun> {
  const runsDir = join(workspace, ".turbo", "runs");
  const before = new Set(await readdir(runsDir).catch(() => []));
  const args = [
    ...(config.turbo.args ?? []), "run", config.turbo.task,
    ...(config.turbo.packages ?? []).flatMap((name) => ["--filter", name]),
    "--cache=local:rw", "--cache-dir", cacheDir, "--summarize", "--ui=stream", "--no-color",
    ...(config.turbo.concurrency === undefined ? [] : ["--concurrency", String(config.turbo.concurrency)]),
  ];
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    ...config.turbo.environment,
    TURBO_TOKEN: "",
    TURBO_TEAM: "",
    TURBO_REMOTE_ONLY: "",
  };
  const processResult = await runProcess(config.turbo.command, args, {
    cwd: workspace,
    env,
    timeoutMs: config.turbo.timeoutMs,
    ...(signal === undefined ? {} : { signal }),
  });
  const created = (await readdir(runsDir).catch(() => [])).filter((name) => !before.has(name));
  if (created.length !== 1) {
    return { process: processResult, tasks: [], error: `Expected one Turbo summary, found ${created.length}` };
  }
  const summaryPath = join(runsDir, created[0]!);
  try {
    const parsed = parseVerificationSummary(
      JSON.parse(await readFile(summaryPath, "utf8")),
      config.tasks.map((task) => task.id),
    );
    return { process: processResult, summaryPath, tasks: parsed.tasks, turboVersion: parsed.turboVersion };
  } catch (error) {
    return { process: processResult, summaryPath, tasks: [], error: String(error) };
  }
}

function sameSet(left: readonly string[], right: readonly string[]): boolean {
  const a = [...new Set(left.map(portable))].sort();
  const b = [...new Set(right.map(portable))].sort();
  return a.length === b.length && a.every((value, index) => value === b[index]);
}

export function validateOutputCoverage(
  config: VerificationConfig,
  tasks: readonly ObservedTurboTask[],
): { valid: boolean; discrepancies: string[] } {
  const discrepancies: string[] = [];
  for (const expected of config.outputs) {
    const observed = tasks.find((task) => task.id === expected.taskId);
    if (observed === undefined) {
      discrepancies.push(`${expected.taskId}: no Turbo task evidence`);
      continue;
    }
    if (!sameSet(expected.include, observed.outputs)) {
      discrepancies.push(`${expected.taskId}: configured includes differ from Turbo outputs`);
    }
    if (!sameSet(expected.exclude ?? [], observed.excludedOutputs)) {
      discrepancies.push(`${expected.taskId}: configured exclusions differ from Turbo exclusions`);
    }
  }
  return { valid: discrepancies.length === 0, discrepancies };
}
