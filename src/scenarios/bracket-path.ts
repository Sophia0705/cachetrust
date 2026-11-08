import { readFile, rm, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { fingerprintFile } from "../fingerprint.js";
import type { Scenario, ScenarioResult, ScenarioStatus } from "../scenario.js";
import { runTurbo, type TurboRunEvidence } from "../turbo.js";
import { createTemporaryWorkspace } from "../workspace.js";

const INPUT = join("packages", "app", "src", "[id]", "page.js");
const OUTPUT = join("packages", "app", "dist", "page.js");

export interface BracketExperimentEvidence {
  inputPattern: string;
  first: TurboRunEvidence;
  second: TurboRunEvidence;
  baseline: TurboRunEvidence;
  fingerprints?: { v1: string; v2: string; cachedOutput: string; baselineOutput: string };
}

export function classifyBracketExperiment(evidence: BracketExperimentEvidence): ScenarioStatus {
  const runs = [evidence.first, evidence.second, evidence.baseline];
  if (runs.some((run) => run.process.timedOut || run.process.exitCode !== 0)) {
    return "ENVIRONMENT_ERROR";
  }
  if (runs.some((run) => run.task === undefined) || evidence.fingerprints === undefined) {
    return "INCONCLUSIVE";
  }
  if (evidence.second.task!.cache.status === "HIT"
      && evidence.second.task!.cache.local
      && evidence.fingerprints.cachedOutput !== evidence.fingerprints.baselineOutput) {
    return "STALE_HIT";
  }
  return evidence.second.task!.cache.status === "MISS"
      && evidence.second.task!.hash !== evidence.first.task!.hash
      && evidence.fingerprints.cachedOutput === evidence.fingerprints.baselineOutput
    ? "PASS"
    : "INCONCLUSIVE";
}

async function setInputPattern(workspace: string, inputPattern: string): Promise<void> {
  const configPath = join(workspace, "turbo.json");
  const config = JSON.parse(await readFile(configPath, "utf8")) as {
    tasks: { build: { inputs: string[] } };
  };
  config.tasks.build.inputs = [inputPattern];
  await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`);
}

async function runExperiment(
  fixturePath: string,
  inputPattern: string,
  timeoutMs: number,
): Promise<BracketExperimentEvidence> {
  const workspace = await createTemporaryWorkspace(fixturePath);
  const baseline = await createTemporaryWorkspace(fixturePath);
  try {
    await setInputPattern(workspace.fixture, inputPattern);
    await setInputPattern(baseline.fixture, inputPattern);
    const input = join(workspace.fixture, INPUT);
    const output = join(workspace.fixture, OUTPUT);
    await writeFile(input, "v1\n");
    const v1 = await fingerprintFile(input);
    const first = await runTurbo(workspace.fixture, workspace.cache, timeoutMs);

    await writeFile(input, "v2\n");
    const v2 = await fingerprintFile(input);
    await rm(join(workspace.fixture, "packages", "app", "dist"), { recursive: true, force: true });
    const second = await runTurbo(workspace.fixture, workspace.cache, timeoutMs);

    const baselineInput = join(baseline.fixture, INPUT);
    await writeFile(baselineInput, "v2\n");
    const baselineRun = await runTurbo(baseline.fixture, baseline.cache, timeoutMs);

    let fingerprints: BracketExperimentEvidence["fingerprints"];
    try {
      fingerprints = {
        v1,
        v2,
        cachedOutput: await fingerprintFile(output),
        baselineOutput: await fingerprintFile(join(baseline.fixture, OUTPUT)),
      };
    } catch {
      // Missing output means the run cannot support a cache verdict.
    }
    return fingerprints === undefined
      ? { inputPattern, first, second, baseline: baselineRun }
      : { inputPattern, first, second, baseline: baselineRun, fingerprints };
  } finally {
    await Promise.all([workspace.cleanup(), baseline.cleanup()]);
  }
}

function resolveFixture(path: string): string {
  return basename(path) === "bracket-path" ? path : join(path, "bracket-path");
}

export const bracketPathScenario: Scenario = {
  id: "bracket-path",
  description: "Detect stale hits caused by an unescaped [id] input path",
  async run(context): Promise<ScenarioResult> {
    const fixturePath = resolveFixture(context.fixturePath);
    const timeoutMs = context.timeoutMs ?? 30_000;
    const vulnerable = await runExperiment(fixturePath, "src/[id]/page.js", timeoutMs);
    const control = await runExperiment(fixturePath, "src/**", timeoutMs);
    const vulnerableStatus = classifyBracketExperiment(vulnerable);
    const controlStatus = classifyBracketExperiment(control);
    const status = controlStatus === "PASS" ? vulnerableStatus : "INCONCLUSIVE";
    return {
      scenarioId: "bracket-path",
      status,
      message: status === "STALE_HIT"
        ? "Turbo replayed v1 output after the literal [id] input changed to v2."
        : status === "PASS"
          ? "No stale local cache hit was observed."
          : `Vulnerable case: ${vulnerableStatus}; control: ${controlStatus}.`,
      evidence: { turboVersion: "2.11.9", vulnerable, control },
    };
  },
};
