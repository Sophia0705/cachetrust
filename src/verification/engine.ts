import { createHash } from "node:crypto";
import { fingerprintFile } from "../fingerprint.js";
import { release } from "node:os";
import { ConfigError, validateVerificationConfig, type VerificationConfig } from "./config.js";
import { evidenceInstall, evidenceRun, writeEvidence, type VerificationEvidence } from "./evidence.js";
import {
  assertCleanGitProject,
  createVerificationIsolation,
  IsolationError,
  type VerificationIsolation,
} from "./isolation.js";
import { applyMutation, captureMutationOriginal, restoreMutation } from "./mutation.js";
import {
  cleanOutputs,
  fingerprintOutputs,
  normalizeManifest,
  runFunctionalChecks,
  type FunctionalCheckResult,
  type OutputManifest,
} from "./outputs.js";
import { runVerificationTurbo, validateOutputCoverage, type VerificationRun } from "./turbo-runner.js";
import { classifyVerification, type VerificationVerdict } from "./verdict.js";

interface RunSet {
  v1?: VerificationRun;
  cache?: VerificationRun;
  baselineA?: VerificationRun;
  baselineB?: VerificationRun;
}

function assertHealthyRun(run: VerificationRun, expectedVersion: string): void {
  if (run.process.timedOut) throw new EngineError("TIMEOUT", "Turbo build timed out");
  if (run.process.exitCode !== 0) throw new EngineError("BUILD_FAILED", "Turbo build failed");
  if (run.error !== undefined) throw new EngineError("SUMMARY_INVALID", run.error);
  if (run.turboVersion !== expectedVersion) {
    throw new EngineError("SUMMARY_INVALID", "Turbo summary version differs from configuration");
  }
}

class EngineError extends Error {
  constructor(readonly reasonCode: string, message: string) {
    super(message);
  }
}

function isAborted(signal: AbortSignal | undefined): boolean {
  return signal?.aborted ?? false;
}

function functionalDifference(config: VerificationConfig): boolean {
  const checks = config.functionalChecks ?? [];
  return checks.some((cache) => cache.target === "cache" && checks.some((baseline) =>
    baseline.target === "baseline"
      && ((cache.contains !== undefined && baseline.notContains === cache.contains)
        || (cache.notContains !== undefined && baseline.contains === cache.notContains))));
}

function comparisonManifest(
  raw: OutputManifest,
  normalized: OutputManifest | undefined,
): OutputManifest {
  return normalized ?? raw;
}

function baseEvidence(
  config: VerificationConfig,
  commit: string,
  startedAt: string,
  lockfileSha256: Record<string, string>,
  verdict: VerificationEvidence["verdict"],
): VerificationEvidence {
  const normalization = config.normalization === undefined ? undefined : {
    id: config.normalization.id,
    description: config.normalization.description,
    omit: config.normalization.omit ?? [],
    replaceLiterals: (config.normalization.replaceLiterals ?? []).map((rule) => ({
      path: rule.path,
      reason: rule.reason,
      searchSha256: createHash("sha256").update(rule.search).digest("hex"),
      replacement: rule.replacement,
    })),
  };
  return {
    schemaVersion: "cachetrust.verification/1",
    cachetrustVersion: "0.1.0",
    caseId: config.id,
    startedAt,
    finishedAt: new Date().toISOString(),
    environment: {
      os: `${process.platform} ${release()}`,
      arch: process.arch,
      node: process.version,
      packageManager: `${config.install.packageManager} ${config.install.packageManagerVersion}`,
      turbo: config.turbo.version,
    },
    target: { projectLabel: "target", commit, dirty: false },
    config: {
      task: config.turbo.task,
      packages: config.turbo.packages ?? [],
      tasks: config.tasks,
      outputs: config.outputs,
      mutationKind: config.mutation.kind,
      ...(normalization === undefined ? {} : { normalization }),
    },
    installs: [],
    isolation: {
      strategy: "independent-frozen-install",
      workspaces: ["cache", "baseline-a", "baseline-b"],
      caches: ["cache/shared", "baseline-a/empty", "baseline-b/empty"],
      remoteCacheDisabled: true,
      lockfileSha256,
    },
    runs: [],
    verdict,
    injectedFault: config.preparedFault !== undefined,
    limitations: [
      "Dependency lifecycle scripts are trusted and are not sandboxed by CacheTrust.",
      "Raw stdout/stderr content is not retained by default; byte counts and SHA-256 digests are recorded.",
    ],
  };
}

function addInstalls(evidence: VerificationEvidence, isolation: VerificationIsolation | undefined): void {
  if (isolation === undefined) return;
  evidence.installs = isolation.workspaces.map((workspace) =>
    evidenceInstall(workspace.id, workspace.install));
}

function addRuns(evidence: VerificationEvidence, runs: RunSet): void {
  if (runs.v1 !== undefined) evidence.runs.push(evidenceRun("v1", runs.v1));
  if (runs.cache !== undefined) evidence.runs.push(evidenceRun("cache-v2", runs.cache));
  if (runs.baselineA !== undefined) evidence.runs.push(evidenceRun("baseline-a-v2", runs.baselineA));
  if (runs.baselineB !== undefined) evidence.runs.push(evidenceRun("baseline-b-v2", runs.baselineB));
}

function errorVerdict(error: unknown): VerificationEvidence["verdict"] {
  const reasonCode = error instanceof IsolationError || error instanceof EngineError
    ? error.reasonCode
    : error instanceof ConfigError ? error.reasonCode : "UNEXPECTED_ERROR";
  const inconclusive = reasonCode === "DIRTY_REPOSITORY" || reasonCode === "PRECONDITION_MISMATCH"
    || reasonCode === "UNSUPPORTED_CONFIGURATION";
  return {
    status: inconclusive ? "INCONCLUSIVE" : "ENVIRONMENT_ERROR",
    reasonCodes: [reasonCode],
    implicatedTasks: [],
    explanation: error instanceof Error ? error.message : String(error),
  };
}

export async function verifyProject(
  value: unknown,
  options: { signal?: AbortSignal } = {},
): Promise<VerificationEvidence> {
  const config = validateVerificationConfig(value);
  const startedAt = new Date().toISOString();
  let commit = "unknown";
  let isolation: VerificationIsolation | undefined;
  const runs: RunSet = {};
  try {
    commit = await assertCleanGitProject(config.projectRoot, options.signal);
    if (isAborted(options.signal)) throw new EngineError("CANCELLED", "Verification was cancelled");
    isolation = await createVerificationIsolation(config, options.signal);
    const [cacheWorkspace, baselineAWorkspace, baselineBWorkspace] = isolation.workspaces;

    await cleanOutputs(cacheWorkspace.project, config.outputs);
    runs.v1 = await runVerificationTurbo(cacheWorkspace.project, cacheWorkspace.cache, config, options.signal);
    if (isAborted(options.signal)) throw new EngineError("CANCELLED", "Verification was cancelled");
    assertHealthyRun(runs.v1, config.turbo.version);
    const coverage = validateOutputCoverage(config, runs.v1.tasks);
    if (!coverage.valid) {
      const verdict: VerificationVerdict = {
        status: "INCONCLUSIVE",
        reasonCodes: ["OUTPUT_COVERAGE_MISMATCH"],
        implicatedTasks: [],
        explanation: coverage.discrepancies.join("; "),
      };
      const evidence = baseEvidence(config, commit, startedAt, isolation.lockfileSha256, verdict);
      addInstalls(evidence, isolation);
      addRuns(evidence, runs);
      await writeEvidence(config.evidenceFile, evidence);
      return evidence;
    }

    const originalCache = await captureMutationOriginal(cacheWorkspace.project, config.mutation);
    const originalA = await captureMutationOriginal(baselineAWorkspace.project, config.mutation);
    const originalB = await captureMutationOriginal(baselineBWorkspace.project, config.mutation);
    try {
      await applyMutation(cacheWorkspace.project, config.mutation);
      await cleanOutputs(cacheWorkspace.project, config.outputs);
      runs.cache = await runVerificationTurbo(
        cacheWorkspace.project, cacheWorkspace.cache, config, options.signal,
      );
      if (isAborted(options.signal)) throw new EngineError("CANCELLED", "Verification was cancelled");
      assertHealthyRun(runs.cache, config.turbo.version);
      const cacheRaw = await fingerprintOutputs(cacheWorkspace.project, config.outputs);
      const cacheChecks = await runFunctionalChecks(
        cacheWorkspace.project, config.functionalChecks ?? [], "cache",
      );

      await applyMutation(baselineAWorkspace.project, config.mutation);
      await cleanOutputs(baselineAWorkspace.project, config.outputs);
      runs.baselineA = await runVerificationTurbo(
        baselineAWorkspace.project, baselineAWorkspace.cache, config, options.signal,
      );
      if (isAborted(options.signal)) throw new EngineError("CANCELLED", "Verification was cancelled");
      assertHealthyRun(runs.baselineA, config.turbo.version);
      const baselineARaw = await fingerprintOutputs(baselineAWorkspace.project, config.outputs);
      const baselineAChecks = await runFunctionalChecks(
        baselineAWorkspace.project, config.functionalChecks ?? [], "baseline",
      );

      await applyMutation(baselineBWorkspace.project, config.mutation);
      await cleanOutputs(baselineBWorkspace.project, config.outputs);
      runs.baselineB = await runVerificationTurbo(
        baselineBWorkspace.project, baselineBWorkspace.cache, config, options.signal,
      );
      if (isAborted(options.signal)) throw new EngineError("CANCELLED", "Verification was cancelled");
      assertHealthyRun(runs.baselineB, config.turbo.version);
      const baselineBRaw = await fingerprintOutputs(baselineBWorkspace.project, config.outputs);
      const baselineBChecks = await runFunctionalChecks(
        baselineBWorkspace.project, config.functionalChecks ?? [], "baseline",
      );

      let cacheNormalized: OutputManifest | undefined;
      let baselineANormalized: OutputManifest | undefined;
      let baselineBNormalized: OutputManifest | undefined;
      if (config.normalization !== undefined) {
        cacheNormalized = await normalizeManifest(cacheWorkspace.project, cacheRaw, config.normalization);
        baselineANormalized = await normalizeManifest(
          baselineAWorkspace.project, baselineARaw, config.normalization,
        );
        baselineBNormalized = await normalizeManifest(
          baselineBWorkspace.project, baselineBRaw, config.normalization,
        );
      }

      const cacheComparison = comparisonManifest(cacheRaw, cacheNormalized);
      const baselineAComparison = comparisonManifest(baselineARaw, baselineANormalized);
      const baselineBComparison = comparisonManifest(baselineBRaw, baselineBNormalized);
      const checks: FunctionalCheckResult[] = [...cacheChecks, ...baselineAChecks, ...baselineBChecks];
      const outputCoverageValid = [runs.cache, runs.baselineA, runs.baselineB]
        .every((run) => validateOutputCoverage(config, run.tasks).valid);
      const baselineChecksRequired = config.mutation.kind === "replace-file";
      const hasBaselineCheck = baselineAChecks.length > 0 && baselineBChecks.length > 0;
      const mutationEffectProven = config.mutation.kind === "none"
        || ((!baselineChecksRequired || hasBaselineCheck) && checks.every((check) => check.passed));
      const verdict = classifyVerification({
        expectedTasks: config.tasks,
        v1Tasks: runs.v1.tasks,
        cacheTasks: runs.cache.tasks,
        baselineATasks: runs.baselineA.tasks,
        baselineBTasks: runs.baselineB.tasks,
        outputCoverageValid,
        baselinesStable: baselineAComparison.sha256 === baselineBComparison.sha256,
        cacheMatchesBaseline: cacheComparison.sha256 === baselineAComparison.sha256,
        rawCacheMatchesBaseline: cacheRaw.sha256 === baselineARaw.sha256,
        normalizationUsed: config.normalization !== undefined,
        mutationEffectProven,
        functionalDifferenceConfirmed: functionalDifference(config) && checks.every((check) => check.passed),
      });
      const evidence = baseEvidence(config, commit, startedAt, isolation.lockfileSha256, verdict);
      addInstalls(evidence, isolation);
      addRuns(evidence, runs);
      evidence.comparisons = {
        cacheRaw, baselineARaw, baselineBRaw,
        ...(cacheNormalized === undefined ? {} : { cacheNormalized }),
        ...(baselineANormalized === undefined ? {} : { baselineANormalized }),
        ...(baselineBNormalized === undefined ? {} : { baselineBNormalized }),
        baselineStable: baselineAComparison.sha256 === baselineBComparison.sha256,
        cacheMatchesBaseline: cacheComparison.sha256 === baselineAComparison.sha256,
        functionalChecks: checks,
      };
      const restored = await Promise.all([
        restoreMutation(cacheWorkspace.project, config.mutation, originalCache),
        restoreMutation(baselineAWorkspace.project, config.mutation, originalA),
        restoreMutation(baselineBWorkspace.project, config.mutation, originalB),
      ]);
      if (restored.some((value) => !value)) throw new EngineError("MUTATION_OPERATION_FAILED", "Restore failed");
      if (config.mutation.kind === "replace-file"
          && await fingerprintFile(`${config.projectRoot}/${config.mutation.path}`)
            !== config.mutation.expectedBeforeSha256) {
        throw new EngineError("ORIGINAL_CHANGED", "Original project mutation input changed");
      }
      await writeEvidence(config.evidenceFile, evidence);
      return evidence;
    } catch (error) {
      if (error instanceof Error && error.message.startsWith("Mutation precondition mismatch")) {
        throw new EngineError("PRECONDITION_MISMATCH", error.message);
      }
      throw error;
    }
  } catch (error) {
    const evidence = baseEvidence(config, commit, startedAt, isolation?.lockfileSha256 ?? {}, errorVerdict(error));
    addInstalls(evidence, isolation);
    addRuns(evidence, runs);
    await writeEvidence(config.evidenceFile, evidence);
    return evidence;
  } finally {
    await isolation?.cleanup();
  }
}
