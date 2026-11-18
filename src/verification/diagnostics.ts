import { constants, copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fingerprintFile } from "../fingerprint.js";
import type { DurableProcessFiles, ProcessResult } from "../process.js";
import { resolveInside } from "./config.js";
import type { OutputManifest } from "./outputs.js";
import type { VerificationRun } from "./turbo-runner.js";

export interface DiagnosticArtifact {
  id: string;
  kind: "process-log" | "process-lifecycle" | "turbo-summary" | "raw-output";
  path: string;
  sha256?: string;
  files?: number;
  bytes?: number;
  verified: true;
}

export async function initializeDiagnostics(evidenceFile: string): Promise<string> {
  const root = join(dirname(evidenceFile), "artifacts");
  await mkdir(dirname(evidenceFile), { recursive: true });
  await mkdir(root);
  return root;
}

export async function durableProcessFiles(root: string, id: string): Promise<DurableProcessFiles> {
  const logs = join(root, "logs");
  await mkdir(logs, { recursive: true });
  return {
    stdoutPath: join(logs, `${id}.stdout.log`),
    stderrPath: join(logs, `${id}.stderr.log`),
    lifecyclePath: join(logs, `${id}.lifecycle.jsonl`),
  };
}

async function retainText(
  root: string,
  id: string,
  suffix: string,
  value: string,
): Promise<DiagnosticArtifact> {
  const relative = `logs/${id}.${suffix}.log`;
  const path = join(root, relative);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, value, { flag: "wx" });
  return { id, kind: "process-log", path: `artifacts/${relative}`, sha256: await fingerprintFile(path), verified: true };
}

export async function retainProcess(
  root: string,
  id: string,
  process: ProcessResult,
): Promise<DiagnosticArtifact[]> {
  const files = await durableProcessFiles(root, id);
  const retainedStdout = await readFile(files.stdoutPath, "utf8").catch(() => undefined);
  const retainedStderr = await readFile(files.stderrPath, "utf8").catch(() => undefined);
  if (retainedStdout === undefined && retainedStderr === undefined) {
    return await Promise.all([
      retainText(root, id, "stdout", process.stdout),
      retainText(root, id, "stderr", process.stderr),
    ]);
  }
  if (retainedStdout !== process.stdout || retainedStderr !== process.stderr) {
    throw new Error(`Durable process log mismatch: ${id}`);
  }
  const artifacts: DiagnosticArtifact[] = [
    {
      id, kind: "process-log", path: `artifacts/logs/${id}.stdout.log`,
      sha256: await fingerprintFile(files.stdoutPath), verified: true,
    },
    {
      id, kind: "process-log", path: `artifacts/logs/${id}.stderr.log`,
      sha256: await fingerprintFile(files.stderrPath), verified: true,
    },
  ];
  const lifecycle = await readFile(files.lifecyclePath, "utf8").catch(() => undefined);
  if (lifecycle === undefined) throw new Error(`Durable process lifecycle missing: ${id}`);
  for (const line of lifecycle.split(/\r?\n/).filter(Boolean)) JSON.parse(line);
  artifacts.push({
    id, kind: "process-lifecycle", path: `artifacts/logs/${id}.lifecycle.jsonl`,
    sha256: await fingerprintFile(files.lifecyclePath), verified: true,
  });
  return artifacts;
}

export async function retainRun(
  root: string,
  id: string,
  run: VerificationRun,
): Promise<DiagnosticArtifact[]> {
  const artifacts = await retainProcess(root, id, run.process);
  if (run.summaryPath !== undefined) {
    const relative = `summaries/${id}.json`;
    const path = join(root, relative);
    await mkdir(dirname(path), { recursive: true });
    await copyFile(run.summaryPath, path, constants.COPYFILE_EXCL);
    artifacts.push({
      id, kind: "turbo-summary", path: `artifacts/${relative}`,
      sha256: await fingerprintFile(path), verified: true,
    });
  }
  return artifacts;
}

export async function retainRawOutputs(
  root: string,
  id: string,
  workspace: string,
  manifest: OutputManifest,
): Promise<DiagnosticArtifact> {
  const snapshot = join(root, "outputs", id);
  await mkdir(snapshot, { recursive: true });
  let bytes = 0;
  for (const entry of manifest.entries) {
    const source = resolveInside(workspace, entry.path, "diagnostic output");
    const destination = resolveInside(snapshot, entry.path, "diagnostic output");
    await mkdir(dirname(destination), { recursive: true });
    await copyFile(source, destination, constants.COPYFILE_EXCL);
    if (await fingerprintFile(destination) !== entry.sha256) {
      throw new Error(`Diagnostic output copy mismatch: ${entry.path}`);
    }
    bytes += entry.bytes;
  }
  const manifestPath = join(root, "outputs", `${id}.manifest.json`);
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, { flag: "wx" });
  const retained = JSON.parse(await readFile(manifestPath, "utf8")) as OutputManifest;
  if (retained.sha256 !== manifest.sha256 || retained.entries.length !== manifest.entries.length) {
    throw new Error(`Diagnostic manifest verification failed: ${id}`);
  }
  return {
    id, kind: "raw-output", path: `artifacts/outputs/${id}`,
    sha256: manifest.sha256, files: manifest.entries.length, bytes, verified: true,
  };
}
