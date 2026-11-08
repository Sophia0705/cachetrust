import { access, readFile, rm, watch, writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { fingerprintFile } from "../fingerprint.js";
import type { Scenario, ScenarioResult, ScenarioStatus } from "../scenario.js";
import { runTurbo, type TurboRunEvidence } from "../turbo.js";
import { createTemporaryWorkspace } from "../workspace.js";

const APP = join("packages", "app");
const INPUT = join(APP, "src", "a.txt");
const OUTPUT = join(APP, "dist", "o.txt");

export interface MutationEvidence {
  mutationRun: TurboRunEvidence;
  replayRun: TurboRunEvidence;
  baselineRun: TurboRunEvidence;
  fingerprints?: {
    before: string;
    afterMutation: string;
    afterRevert: string;
    mutationOutput: string;
    replayOutput: string;
    baselineOutput: string;
  };
  synchronizationError?: string;
}

export function classifyMutation(evidence: MutationEvidence): ScenarioStatus {
  const runs = [evidence.mutationRun, evidence.replayRun, evidence.baselineRun];
  if (evidence.synchronizationError !== undefined
      || runs.some((run) => run.process.timedOut || run.process.exitCode !== 0)) {
    return "ENVIRONMENT_ERROR";
  }
  if (runs.some((run) => run.task === undefined) || evidence.fingerprints === undefined) {
    return "INCONCLUSIVE";
  }
  const { fingerprints } = evidence;
  if (fingerprints.before !== fingerprints.afterRevert
      || fingerprints.before === fingerprints.afterMutation) return "INCONCLUSIVE";
  if (evidence.replayRun.task!.cache.status === "HIT"
      && evidence.replayRun.task!.cache.local
      && evidence.mutationRun.task!.hash === evidence.replayRun.task!.hash
      && fingerprints.mutationOutput === fingerprints.replayOutput
      && fingerprints.replayOutput !== fingerprints.baselineOutput) return "UNSAFE_SAVE";
  return fingerprints.replayOutput === fingerprints.baselineOutput ? "PASS" : "INCONCLUSIVE";
}

async function waitForFile(path: string, timeoutMs: number): Promise<void> {
  if (await access(path).then(() => true, () => false)) return;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    for await (const event of watch(dirname(path), { signal: controller.signal })) {
      if (event.filename === basename(path)
          && await access(path).then(() => true, () => false)) return;
    }
    throw new Error(`File watcher ended before ${basename(path)} was created`);
  } catch (error) {
    if (controller.signal.aborted) throw new Error(`Timed out waiting for ${basename(path)}`);
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

async function runMutation(fixturePath: string, timeoutMs: number): Promise<MutationEvidence> {
  const workspace = await createTemporaryWorkspace(fixturePath);
  const baseline = await createTemporaryWorkspace(fixturePath);
  try {
    const input = join(workspace.fixture, INPUT);
    const app = join(workspace.fixture, APP);
    const ready = join(app, ".cachetrust-ready");
    const proceed = join(app, ".cachetrust-continue");
    await writeFile(input, "v2\n");
    const before = await fingerprintFile(input);
    const mutationPromise = runTurbo(workspace.fixture, workspace.cache, timeoutMs, "2.11.8");

    let synchronizationError: string | undefined;
    try {
      await waitForFile(ready, timeoutMs);
      await writeFile(input, "v3\n");
      await writeFile(proceed, "continue\n");
    } catch (error) {
      synchronizationError = String(error);
      await writeFile(proceed, "continue\n").catch(() => undefined);
    }
    const mutationRun = await mutationPromise;
    const afterMutation = await fingerprintFile(input);
    const mutationOutput = await fingerprintFile(join(workspace.fixture, OUTPUT)).catch(() => "");

    await writeFile(input, "v2\n");
    const afterRevert = await fingerprintFile(input);
    await rm(join(workspace.fixture, APP, "dist"), { recursive: true, force: true });
    await rm(ready, { force: true });
    await rm(proceed, { force: true });
    const replayRun = await runTurbo(workspace.fixture, workspace.cache, timeoutMs, "2.11.8");
    const replayOutput = await fingerprintFile(join(workspace.fixture, OUTPUT)).catch(() => "");

    const baselineInput = join(baseline.fixture, INPUT);
    const baselineApp = join(baseline.fixture, APP);
    await writeFile(baselineInput, "v2\n");
    await writeFile(join(baselineApp, ".cachetrust-continue"), "continue\n");
    const baselineRun = await runTurbo(baseline.fixture, baseline.cache, timeoutMs, "2.11.8");
    const baselineOutput = await fingerprintFile(join(baseline.fixture, OUTPUT)).catch(() => "");

    const fingerprints = { before, afterMutation, afterRevert, mutationOutput, replayOutput, baselineOutput };
    return synchronizationError === undefined
      ? { mutationRun, replayRun, baselineRun, fingerprints }
      : { mutationRun, replayRun, baselineRun, fingerprints, synchronizationError };
  } finally {
    await Promise.all([workspace.cleanup(), baseline.cleanup()]);
  }
}

function resolveFixture(path: string): string {
  return basename(path) === "mid-build-mutation" ? path : join(path, "mid-build-mutation");
}

export const midBuildMutationScenario: Scenario = {
  id: "mid-build-mutation",
  description: "Detect outputs saved under a stale pre-build input hash",
  async run(context): Promise<ScenarioResult> {
    const evidence = await runMutation(resolveFixture(context.fixturePath), context.timeoutMs ?? 30_000);
    const status = classifyMutation(evidence);
    return {
      scenarioId: "mid-build-mutation",
      status,
      message: status === "UNSAFE_SAVE"
        ? "Turbo saved v3 output under the v2 input hash and replayed it for v2."
        : status === "PASS"
          ? "No unsafe cache save was observed."
          : "The mutation experiment did not produce conclusive cache evidence.",
      evidence: { turboVersion: "2.11.8", ...evidence },
    };
  },
};
