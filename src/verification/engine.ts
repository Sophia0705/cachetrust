import { createHash } from "node:crypto";
import { fingerprintFile } from "../fingerprint.js";
import { release } from "node:os";
import type { ProcessResult } from "../process.js";
import { ConfigError, validateVerificationConfig, type VerificationConfig } from "./config.js";
import { evidenceInstall, evidenceRun, writeEvidence, type VerificationEvidence } from "./evidence.js";
import {
  initializeDiagnostics,
  durableProcessFiles,
  retainProcess,
  retainRawOutputs,
  retainRun,
  type DiagnosticArtifact,
} from "./diagnostics.js";
import {
  assertCleanGitProject,
  createVerificationIsolation,
  IsolationError,
  type VerificationIsolation,
} from "./isolation.js";
import { applyMutation, captureMutationOriginal, restoreMutation } from "./mutation.js";
import {
  PackageManagerError,
  probePackageManager,
  type PackageManagerProbe,
} from "./package-manager.js";
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

function changedPaths(left: OutputManifest, right: OutputManifest): string[] {
  const a = new Map(left.entries.map((entry) => [entry.path, entry.sha256]));
  const b = new Map(right.entries.map((entry) => [entry.path, entry.sha256]));
  return [...new Set([...a.keys(), ...b.keys()])].sort().filter((path) => a.get(path) !== b.get(path));
}

function baseEvidence(
  config: VerificationConfig,
  commit: string,
  startedAt: string,
  lockfileSha256: Record<string, string>,
  verdict: VerificationEvidence["verdict"],
  packageManagerProbe?: {
    observedVersion?: string;
    executable?: string;
    process?: ProcessResult;
    processResult?: ProcessResult;
  },
): VerificationEvidence {
  const publicInstallValue = (name: string, value: string): boolean => {
    const values: Record<string, readonly string[]> = {
      CI: ["", "0", "1", "false", "true"],
      FORCE_COLOR: ["", "0", "1", "2", "3", "false", "true"],
      NODE_ENV: ["development", "production", "test"],
      NO_COLOR: ["", "0", "1", "false", "true"],
      PUPPETEER_SKIP_DOWNLOAD: ["", "0", "1", "false", "true"],
    };
    return values[name.toUpperCase()]?.includes(value.toLowerCase()) ?? false;
  };
  const installVariables = Object.entries(config.install.environment ?? {})
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([name, value]) => publicInstallValue(name, value)
      ? { name, valuePolicy: "public" as const, value }
      : { name, valuePolicy: "private" as const });
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
    deriveLiterals: (config.normalization.deriveLiterals ?? []).map((rule) => ({
      sourcePath: rule.sourcePath,
      ...(rule.jsonPointer === undefined ? {} : { jsonPointer: rule.jsonPointer }),
      target: rule.target,
      replacement: rule.replacement,
      replaceInPath: rule.replaceInPath ?? false,
      jsonStringEncoded: rule.jsonStringEncoded ?? false,
      reason: rule.reason,
    })),
    canonicalizeJson: (config.normalization.canonicalizeJson ?? []).map((rule) => ({
      path: rule.path,
      assignment: rule.assignment ?? false,
      reason: rule.reason,
    })),
  };
  const probeProcess = packageManagerProbe?.process ?? packageManagerProbe?.processResult;
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
      packageManager: {
        name: config.install.packageManager,
        expectedVersion: config.install.packageManagerVersion,
        ...(packageManagerProbe?.observedVersion === undefined
          ? {} : { observedVersion: packageManagerProbe.observedVersion }),
        ...(packageManagerProbe?.executable === undefined
          ? {} : { executable: packageManagerProbe.executable }),
        ...(probeProcess === undefined ? {} : { probe: {
          exitCode: probeProcess.exitCode,
          timedOut: probeProcess.timedOut,
          durationMs: probeProcess.durationMs,
          stdoutSha256: createHash("sha256").update(probeProcess.stdout).digest("hex"),
          stderrSha256: createHash("sha256").update(probeProcess.stderr).digest("hex"),
        } }),
      },
      turbo: config.turbo.version,
      install: {
        inherited: true,
        override: installVariables.length > 0,
        scope: ["package-manager-probe", "cache", "baseline-a", "baseline-b"],
        identicalAcrossInstallProcesses: true,
        variables: installVariables,
      },
    },
    target: { projectLabel: "target", commit, dirty: false },
    config: {
      task: config.turbo.task,
      packages: config.turbo.packages ?? [],
      tasks: config.tasks,
      outputs: config.outputs,
      mutationKind: config.mutation.kind,
      retainDiagnostics: config.retainDiagnostics ?? false,
      ...(config.physicalStorageLimitBytes === undefined ? {} : {
        physicalStorageLimitBytes: config.physicalStorageLimitBytes,
      }),
      ...(normalization === undefined ? {} : { normalization }),
    },
    installs: [],
    isolation: {
      strategy: config.workspaceStrategy ?? "independent-paths",
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
      "Inherited install environment values are not recorded; configured private values are recorded by name only.",
    ],
  };
}

function addInstalls(evidence: VerificationEvidence, isolation: VerificationIsolation | undefined): void {
  if (isolation === undefined) return;
  evidence.installs = isolation.workspaces.flatMap((workspace) => workspace.install === undefined
    ? []
    : [evidenceInstall(workspace.id, workspace.install)]);
  evidence.isolation.lifecycle = isolation.lifecycle;
  evidence.isolation.storageMeasurements = isolation.storageMeasurements;
}

function addDiagnosticArtifacts(
  evidence: VerificationEvidence,
  artifacts: DiagnosticArtifact[],
): void {
  if (artifacts.length > 0) evidence.diagnosticArtifacts = artifacts;
}

function addRuns(evidence: VerificationEvidence, runs: RunSet): void {
  if (runs.v1 !== undefined) evidence.runs.push(evidenceRun("v1", runs.v1));
  if (runs.cache !== undefined) evidence.runs.push(evidenceRun("cache-v2", runs.cache));
  if (runs.baselineA !== undefined) evidence.runs.push(evidenceRun("baseline-a-v2", runs.baselineA));
  if (runs.baselineB !== undefined) evidence.runs.push(evidenceRun("baseline-b-v2", runs.baselineB));
}

function errorVerdict(error: unknown): VerificationEvidence["verdict"] {
  const reasonCode = error instanceof IsolationError || error instanceof EngineError
    || error instanceof PackageManagerError
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
  let packageManagerProbe: PackageManagerProbe | undefined;
  let diagnosticRoot: string | undefined;
  const diagnosticArtifacts: DiagnosticArtifact[] = [];
  const runs: RunSet = {};
  try {
    if (config.retainDiagnostics === true) diagnosticRoot = await initializeDiagnostics(config.evidenceFile);
    commit = await assertCleanGitProject(config.projectRoot, options.signal);
    if (isAborted(options.signal)) throw new EngineError("CANCELLED", "Verification was cancelled");
    packageManagerProbe = await probePackageManager(
      config,
      options.signal,
      diagnosticRoot === undefined
        ? undefined
        : await durableProcessFiles(diagnosticRoot, "package-manager-probe"),
    );
    if (diagnosticRoot !== undefined) {
      diagnosticArtifacts.push(...await retainProcess(diagnosticRoot, "package-manager-probe", packageManagerProbe.process));
    }
    isolation = await createVerificationIsolation(
      config, packageManagerProbe.install, options.signal, diagnosticRoot,
    );
    const cacheWorkspace = await isolation.activate("cache");
    if (diagnosticRoot !== undefined && cacheWorkspace.install !== undefined) {
      diagnosticArtifacts.push(...await retainProcess(diagnosticRoot, "install-cache", cacheWorkspace.install));
    }

    await cleanOutputs(cacheWorkspace.project, config.outputs);
    runs.v1 = await runVerificationTurbo(
      cacheWorkspace.project,
      cacheWorkspace.cache,
      config,
      options.signal,
      diagnosticRoot === undefined ? undefined : await durableProcessFiles(diagnosticRoot, "v1"),
    );
    await isolation.assertStorageWithinLimit("v1-after-build");
    if (diagnosticRoot !== undefined) diagnosticArtifacts.push(...await retainRun(diagnosticRoot, "v1", runs.v1));
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
      const evidence = baseEvidence(
        config, commit, startedAt, isolation.lockfileSha256, verdict, packageManagerProbe,
      );
      addInstalls(evidence, isolation);
      addRuns(evidence, runs);
      addDiagnosticArtifacts(evidence, diagnosticArtifacts);
      await writeEvidence(config.evidenceFile, evidence);
      return evidence;
    }

    const originalCache = await captureMutationOriginal(cacheWorkspace.project, config.mutation);
    try {
      await applyMutation(cacheWorkspace.project, config.mutation);
      await cleanOutputs(cacheWorkspace.project, config.outputs);
      runs.cache = await runVerificationTurbo(
        cacheWorkspace.project,
        cacheWorkspace.cache,
        config,
        options.signal,
        diagnosticRoot === undefined
          ? undefined
          : await durableProcessFiles(diagnosticRoot, "cache-v2"),
      );
      await isolation.assertStorageWithinLimit("cache-v2-after-build");
      if (diagnosticRoot !== undefined) {
        diagnosticArtifacts.push(...await retainRun(diagnosticRoot, "cache-v2", runs.cache));
      }
      if (isAborted(options.signal)) throw new EngineError("CANCELLED", "Verification was cancelled");
      assertHealthyRun(runs.cache, config.turbo.version);
      const cacheRaw = await fingerprintOutputs(cacheWorkspace.project, config.outputs);
      if (diagnosticRoot !== undefined) {
        diagnosticArtifacts.push(await retainRawOutputs(
          diagnosticRoot, "cache-v2", cacheWorkspace.project, cacheRaw,
        ));
      }
      const cacheChecks = await runFunctionalChecks(
        cacheWorkspace.project, config.functionalChecks ?? [], "cache",
      );
      const cacheNormalized = config.normalization === undefined
        ? undefined
        : await normalizeManifest(cacheWorkspace.project, cacheRaw, config.normalization);
      if (!await restoreMutation(cacheWorkspace.project, config.mutation, originalCache)) {
        throw new EngineError("MUTATION_OPERATION_FAILED", "Cache workspace restore failed");
      }

      const baselineAWorkspace = await isolation.activate("baseline-a");
      if (diagnosticRoot !== undefined && baselineAWorkspace.install !== undefined) {
        diagnosticArtifacts.push(...await retainProcess(
          diagnosticRoot, "install-baseline-a", baselineAWorkspace.install,
        ));
      }
      const originalA = await captureMutationOriginal(baselineAWorkspace.project, config.mutation);
      await applyMutation(baselineAWorkspace.project, config.mutation);
      await cleanOutputs(baselineAWorkspace.project, config.outputs);
      runs.baselineA = await runVerificationTurbo(
        baselineAWorkspace.project,
        baselineAWorkspace.cache,
        config,
        options.signal,
        diagnosticRoot === undefined
          ? undefined
          : await durableProcessFiles(diagnosticRoot, "baseline-a-v2"),
      );
      await isolation.assertStorageWithinLimit("baseline-a-v2-after-build");
      if (diagnosticRoot !== undefined) {
        diagnosticArtifacts.push(...await retainRun(diagnosticRoot, "baseline-a-v2", runs.baselineA));
      }
      if (isAborted(options.signal)) throw new EngineError("CANCELLED", "Verification was cancelled");
      assertHealthyRun(runs.baselineA, config.turbo.version);
      const baselineARaw = await fingerprintOutputs(baselineAWorkspace.project, config.outputs);
      if (diagnosticRoot !== undefined) {
        diagnosticArtifacts.push(await retainRawOutputs(
          diagnosticRoot, "baseline-a-v2", baselineAWorkspace.project, baselineARaw,
        ));
      }
      const baselineAChecks = await runFunctionalChecks(
        baselineAWorkspace.project, config.functionalChecks ?? [], "baseline",
      );
      const baselineANormalized = config.normalization === undefined
        ? undefined
        : await normalizeManifest(baselineAWorkspace.project, baselineARaw, config.normalization);
      if (!await restoreMutation(baselineAWorkspace.project, config.mutation, originalA)) {
        throw new EngineError("MUTATION_OPERATION_FAILED", "Baseline A workspace restore failed");
      }

      const baselineBWorkspace = await isolation.activate("baseline-b");
      if (diagnosticRoot !== undefined && baselineBWorkspace.install !== undefined) {
        diagnosticArtifacts.push(...await retainProcess(
          diagnosticRoot, "install-baseline-b", baselineBWorkspace.install,
        ));
      }
      const originalB = await captureMutationOriginal(baselineBWorkspace.project, config.mutation);
      await applyMutation(baselineBWorkspace.project, config.mutation);
      await cleanOutputs(baselineBWorkspace.project, config.outputs);
      runs.baselineB = await runVerificationTurbo(
        baselineBWorkspace.project,
        baselineBWorkspace.cache,
        config,
        options.signal,
        diagnosticRoot === undefined
          ? undefined
          : await durableProcessFiles(diagnosticRoot, "baseline-b-v2"),
      );
      await isolation.assertStorageWithinLimit("baseline-b-v2-after-build");
      if (diagnosticRoot !== undefined) {
        diagnosticArtifacts.push(...await retainRun(diagnosticRoot, "baseline-b-v2", runs.baselineB));
      }
      if (isAborted(options.signal)) throw new EngineError("CANCELLED", "Verification was cancelled");
      assertHealthyRun(runs.baselineB, config.turbo.version);
      const baselineBRaw = await fingerprintOutputs(baselineBWorkspace.project, config.outputs);
      if (diagnosticRoot !== undefined) {
        diagnosticArtifacts.push(await retainRawOutputs(
          diagnosticRoot, "baseline-b-v2", baselineBWorkspace.project, baselineBRaw,
        ));
      }
      const baselineBChecks = await runFunctionalChecks(
        baselineBWorkspace.project, config.functionalChecks ?? [], "baseline",
      );
      const baselineBNormalized = config.normalization === undefined
        ? undefined
        : await normalizeManifest(baselineBWorkspace.project, baselineBRaw, config.normalization);
      if (!await restoreMutation(baselineBWorkspace.project, config.mutation, originalB)) {
        throw new EngineError("MUTATION_OPERATION_FAILED", "Baseline B workspace restore failed");
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
      const evidence = baseEvidence(
        config, commit, startedAt, isolation.lockfileSha256, verdict, packageManagerProbe,
      );
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
        normalizedChangedPaths: {
          baselineA__baselineB: changedPaths(baselineAComparison, baselineBComparison),
          cache__baselineA: changedPaths(cacheComparison, baselineAComparison),
        },
      };
      addDiagnosticArtifacts(evidence, diagnosticArtifacts);
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
    if (diagnosticRoot !== undefined && error instanceof PackageManagerError
        && error.processResult !== undefined) {
      diagnosticArtifacts.push(...await retainProcess(
        diagnosticRoot, "package-manager-probe-failed", error.processResult,
      ));
    }
    const packageManagerObservation = packageManagerProbe ?? (error instanceof PackageManagerError ? {
      ...(error.observedVersion === undefined ? {} : { observedVersion: error.observedVersion }),
      ...(error.executable === undefined ? {} : { executable: error.executable }),
      ...(error.processResult === undefined ? {} : { processResult: error.processResult }),
    } : undefined);
    const evidence = baseEvidence(
      config, commit, startedAt, isolation?.lockfileSha256 ?? {}, errorVerdict(error), packageManagerObservation,
    );
    addInstalls(evidence, isolation);
    addRuns(evidence, runs);
    addDiagnosticArtifacts(evidence, diagnosticArtifacts);
    await writeEvidence(config.evidenceFile, evidence);
    return evidence;
  } finally {
    await isolation?.cleanup();
  }
}
