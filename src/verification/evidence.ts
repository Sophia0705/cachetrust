import { createHash } from "node:crypto";
import { constants, copyFile, mkdir, rm, writeFile } from "node:fs/promises";
import { basename, dirname } from "node:path";
import type { ProcessResult } from "../process.js";
import type { VerificationConfig, VerificationStatus } from "./config.js";
import type { FunctionalCheckResult, OutputManifest } from "./outputs.js";
import type { VerificationRun } from "./turbo-runner.js";
import type { VerificationVerdict } from "./verdict.js";

export interface VerificationEvidence {
  schemaVersion: "cachetrust.verification/1";
  cachetrustVersion: string;
  caseId: string;
  startedAt: string;
  finishedAt: string;
  environment: {
    os: string;
    arch: string;
    node: string;
    packageManager: {
      name: string;
      expectedVersion: string;
      observedVersion?: string;
      executable?: string;
      probe?: {
        exitCode: number | null;
        timedOut: boolean;
        durationMs: number;
        stdoutSha256: string;
        stderrSha256: string;
      };
    };
    turbo: string;
  };
  target: { projectLabel: string; commit: string; dirty: false };
  config: {
    task: string;
    packages: string[];
    tasks: VerificationConfig["tasks"];
    outputs: VerificationConfig["outputs"];
    mutationKind: VerificationConfig["mutation"]["kind"];
    normalization?: {
      id: string;
      description: string;
      omit: Array<{ path: string; reason: string }>;
      replaceLiterals: Array<{
        path: string;
        reason: string;
        searchSha256: string;
        replacement: string;
      }>;
      deriveLiterals: Array<{
        sourcePath: string;
        jsonPointer?: string;
        target: string;
        replacement: string;
        replaceInPath: boolean;
        jsonStringEncoded: boolean;
        reason: string;
      }>;
    };
  };
  installs: Array<{
    workspace: "cache" | "baseline-a" | "baseline-b";
    command: string[];
    exitCode: number | null;
    timedOut: boolean;
    durationMs: number;
    stdout: { bytes: number; sha256: string; retained: false };
    stderr: { bytes: number; sha256: string; retained: false };
  }>;
  isolation: {
    strategy: "independent-frozen-install";
    workspaces: ["cache", "baseline-a", "baseline-b"];
    caches: ["cache/shared", "baseline-a/empty", "baseline-b/empty"];
    remoteCacheDisabled: true;
    lockfileSha256: Record<string, string>;
  };
  runs: EvidenceRun[];
  comparisons?: {
    cacheRaw?: OutputManifest;
    baselineARaw?: OutputManifest;
    baselineBRaw?: OutputManifest;
    cacheNormalized?: OutputManifest;
    baselineANormalized?: OutputManifest;
    baselineBNormalized?: OutputManifest;
    baselineStable: boolean;
    cacheMatchesBaseline: boolean;
    functionalChecks: FunctionalCheckResult[];
  };
  verdict: VerificationVerdict | {
    status: VerificationStatus;
    reasonCodes: string[];
    implicatedTasks: string[];
    explanation: string;
  };
  injectedFault: boolean;
  limitations: string[];
}

export interface EvidenceRun {
  id: "v1" | "cache-v2" | "baseline-a-v2" | "baseline-b-v2";
  command: string[];
  exitCode: number | null;
  timedOut: boolean;
  durationMs: number;
  stdout: { bytes: number; sha256: string; retained: false };
  stderr: { bytes: number; sha256: string; retained: false };
  tasks: VerificationRun["tasks"];
  summaryAvailable: boolean;
  error?: string;
}

function digest(value: string): { bytes: number; sha256: string; retained: false } {
  return {
    bytes: Buffer.byteLength(value),
    sha256: createHash("sha256").update(value).digest("hex"),
    retained: false,
  };
}

function redactArgs(args: readonly string[]): string[] {
  let redactNext = false;
  return args.map((arg) => {
    if (redactNext) {
      redactNext = false;
      return "<REDACTED>";
    }
    if (/token|password|secret|credential/i.test(arg)) {
      redactNext = !arg.includes("=");
      return arg.includes("=") ? `${arg.slice(0, arg.indexOf("=") + 1)}<REDACTED>` : arg;
    }
    return arg;
  });
}

export function evidenceRun(
  id: EvidenceRun["id"],
  run: VerificationRun,
): EvidenceRun {
  return {
    id,
    command: [basename(run.process.command), ...redactArgs(run.process.args)],
    exitCode: run.process.exitCode,
    timedOut: run.process.timedOut,
    durationMs: run.process.durationMs,
    stdout: digest(run.process.stdout),
    stderr: digest(run.process.stderr),
    tasks: run.tasks,
    summaryAvailable: run.summaryPath !== undefined,
    ...(run.error === undefined ? {} : { error: run.error }),
  };
}

export function evidenceInstall(
  workspace: "cache" | "baseline-a" | "baseline-b",
  process: ProcessResult,
): VerificationEvidence["installs"][number] {
  return {
    workspace,
    command: [basename(process.command), ...redactArgs(process.args)],
    exitCode: process.exitCode,
    timedOut: process.timedOut,
    durationMs: process.durationMs,
    stdout: digest(process.stdout),
    stderr: digest(process.stderr),
  };
}

export async function writeEvidence(path: string, evidence: VerificationEvidence): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.${process.pid}.tmp`;
  try {
    await writeFile(temporary, `${JSON.stringify(evidence, null, 2)}\n`, { flag: "wx" });
    await copyFile(temporary, path, constants.COPYFILE_EXCL);
  } finally {
    await rm(temporary, { force: true });
  }
}
