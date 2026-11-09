import { isAbsolute, normalize, relative, resolve, sep } from "node:path";

export type VerificationStatus = "PASS" | "MISMATCH" | "INCONCLUSIVE" | "ENVIRONMENT_ERROR";
export type ExpectedCacheStatus = "HIT" | "MISS";

export interface VerificationConfig {
  schemaVersion: "1";
  id: string;
  projectRoot: string;
  evidenceFile: string;
  install: {
    command: string;
    args: string[];
    packageManager: string;
    packageManagerVersion: string;
    lockfiles: string[];
    timeoutMs: number;
  };
  turbo: {
    command: string;
    args?: string[];
    task: string;
    packages?: string[];
    version: string;
    timeoutMs: number;
    concurrency?: number;
    environment?: Record<string, string>;
  };
  tasks: Array<{ id: string; expectedAfterMutation: ExpectedCacheStatus }>;
  outputs: Array<{ taskId: string; include: string[]; exclude?: string[] }>;
  mutation:
    | { kind: "none" }
    | {
        kind: "replace-file";
        path: string;
        replacementFile: string;
        expectedBeforeSha256: string;
        expectedAfterSha256: string;
      };
  functionalChecks?: Array<{
    target: "cache" | "baseline";
    under: string;
    contains?: string;
    notContains?: string;
  }>;
  normalization?: {
    id: string;
    description: string;
    omit?: Array<{ path: string; reason: string }>;
    replaceLiterals?: Array<{
      path: string;
      search: string;
      replacement: string;
      reason: string;
    }>;
  };
  preparedFault?: {
    kind: "intentional-input-exclusion";
    description: string;
    configFiles: string[];
  };
}

export class ConfigError extends Error {
  readonly reasonCode = "UNSUPPORTED_CONFIGURATION";
}

function object(value: unknown, name: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new ConfigError(`${name} must be an object`);
  }
  return value as Record<string, unknown>;
}

function nonEmptyString(value: unknown, name: string): string {
  if (typeof value !== "string" || value.length === 0) throw new ConfigError(`${name} is required`);
  return value;
}

function positiveInteger(value: unknown, name: string): number {
  if (!Number.isInteger(value) || (value as number) <= 0) {
    throw new ConfigError(`${name} must be a positive integer`);
  }
  return value as number;
}

function strings(value: unknown, name: string, allowEmpty = false): string[] {
  if (!Array.isArray(value) || (!allowEmpty && value.length === 0)
      || value.some((entry) => typeof entry !== "string" || entry.length === 0)) {
    throw new ConfigError(`${name} must be ${allowEmpty ? "an" : "a non-empty"} string array`);
  }
  return value as string[];
}

function array(value: unknown, name: string): unknown[] {
  if (!Array.isArray(value)) throw new ConfigError(`${name} must be an array`);
  return value;
}

export function assertSafeRelativePath(path: string, name = "path"): string {
  if (path.length === 0 || isAbsolute(path)) throw new ConfigError(`${name} must be relative`);
  const normalized = normalize(path);
  if (normalized === ".." || normalized.startsWith(`..${sep}`)) {
    throw new ConfigError(`${name} escapes the project root`);
  }
  return normalized.split(sep).join("/");
}

export function resolveInside(root: string, path: string, name = "path"): string {
  const safe = assertSafeRelativePath(path, name);
  const target = resolve(root, safe);
  const rel = relative(resolve(root), target);
  if (rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel)) {
    throw new ConfigError(`${name} escapes the project root`);
  }
  return target;
}

function validateOutputPattern(pattern: string, name: string): string {
  const value = pattern.endsWith("/**") ? pattern.slice(0, -3) : pattern;
  if (value.includes("*") || value.includes("?")) {
    throw new ConfigError(`${name} supports only literal paths or directory/**`);
  }
  assertSafeRelativePath(value, name);
  return pattern.replaceAll("\\", "/");
}

export function validateVerificationConfig(value: unknown): VerificationConfig {
  const root = object(value, "config");
  if (root.schemaVersion !== "1") throw new ConfigError("schemaVersion must be 1");
  const id = nonEmptyString(root.id, "id");
  const projectRoot = resolve(nonEmptyString(root.projectRoot, "projectRoot"));
  const evidenceFile = resolve(nonEmptyString(root.evidenceFile, "evidenceFile"));

  const installValue = object(root.install, "install");
  const install = {
    command: nonEmptyString(installValue.command, "install.command"),
    args: strings(installValue.args, "install.args", true),
    packageManager: nonEmptyString(installValue.packageManager, "install.packageManager"),
    packageManagerVersion: nonEmptyString(installValue.packageManagerVersion, "install.packageManagerVersion"),
    lockfiles: strings(installValue.lockfiles, "install.lockfiles").map((path, index) =>
      assertSafeRelativePath(path, `install.lockfiles[${index}]`)),
    timeoutMs: positiveInteger(installValue.timeoutMs, "install.timeoutMs"),
  };
  if (!install.args.some((arg) => arg === "--frozen-lockfile" || arg === "--immutable")) {
    throw new ConfigError("install.args must enforce a frozen lockfile");
  }

  const turboValue = object(root.turbo, "turbo");
  const packages = turboValue.packages === undefined
    ? undefined
    : strings(turboValue.packages, "turbo.packages");
  const environmentValue = turboValue.environment;
  let environment: Record<string, string> | undefined;
  if (environmentValue !== undefined) {
    const parsed = object(environmentValue, "turbo.environment");
    if (Object.values(parsed).some((entry) => typeof entry !== "string")) {
      throw new ConfigError("turbo.environment values must be strings");
    }
    environment = parsed as Record<string, string>;
  }
  const turbo: VerificationConfig["turbo"] = {
    command: nonEmptyString(turboValue.command, "turbo.command"),
    task: nonEmptyString(turboValue.task, "turbo.task"),
    version: nonEmptyString(turboValue.version, "turbo.version"),
    timeoutMs: positiveInteger(turboValue.timeoutMs, "turbo.timeoutMs"),
    ...(turboValue.args === undefined ? {} : { args: strings(turboValue.args, "turbo.args", true) }),
    ...(packages === undefined ? {} : { packages }),
    ...(turboValue.concurrency === undefined ? {} : {
      concurrency: positiveInteger(turboValue.concurrency, "turbo.concurrency"),
    }),
    ...(environment === undefined ? {} : { environment }),
  };

  if (!Array.isArray(root.tasks) || root.tasks.length === 0) throw new ConfigError("tasks are required");
  const tasks = root.tasks.map((entry, index) => {
    const task = object(entry, `tasks[${index}]`);
    const expected = task.expectedAfterMutation;
    if (expected !== "HIT" && expected !== "MISS") {
      throw new ConfigError(`tasks[${index}].expectedAfterMutation must be HIT or MISS`);
    }
    return {
      id: nonEmptyString(task.id, `tasks[${index}].id`),
      expectedAfterMutation: expected as ExpectedCacheStatus,
    };
  });
  if (new Set(tasks.map((task) => task.id)).size !== tasks.length) {
    throw new ConfigError("task ids must be unique");
  }

  if (!Array.isArray(root.outputs) || root.outputs.length === 0) throw new ConfigError("outputs are required");
  const outputs = root.outputs.map((entry, index) => {
    const output = object(entry, `outputs[${index}]`);
    const taskId = nonEmptyString(output.taskId, `outputs[${index}].taskId`);
    const include = strings(output.include, `outputs[${index}].include`).map((pattern, patternIndex) =>
      validateOutputPattern(pattern, `outputs[${index}].include[${patternIndex}]`));
    const exclude = output.exclude === undefined
      ? undefined
      : strings(output.exclude, `outputs[${index}].exclude`, true).map((pattern, patternIndex) =>
        validateOutputPattern(pattern, `outputs[${index}].exclude[${patternIndex}]`));
    return { taskId, include, ...(exclude === undefined ? {} : { exclude }) };
  });
  if (new Set(outputs.map((output) => output.taskId)).size !== outputs.length
      || outputs.some((output) => !tasks.some((task) => task.id === output.taskId))) {
    throw new ConfigError("outputs must identify each selected task exactly once");
  }

  const mutationValue = object(root.mutation, "mutation");
  let mutation: VerificationConfig["mutation"];
  if (mutationValue.kind === "none") {
    mutation = { kind: "none" };
  } else if (mutationValue.kind === "replace-file") {
    mutation = {
      kind: "replace-file",
      path: assertSafeRelativePath(nonEmptyString(mutationValue.path, "mutation.path"), "mutation.path"),
      replacementFile: resolve(nonEmptyString(mutationValue.replacementFile, "mutation.replacementFile")),
      expectedBeforeSha256: nonEmptyString(mutationValue.expectedBeforeSha256, "mutation.expectedBeforeSha256"),
      expectedAfterSha256: nonEmptyString(mutationValue.expectedAfterSha256, "mutation.expectedAfterSha256"),
    };
  } else {
    throw new ConfigError("mutation.kind must be none or replace-file");
  }

  const checks = root.functionalChecks === undefined ? undefined : array(root.functionalChecks, "functionalChecks").map(
    (entry, index) => {
      const check = object(entry, `functionalChecks[${index}]`);
      if (check.target !== "cache" && check.target !== "baseline") {
        throw new ConfigError(`functionalChecks[${index}].target must be cache or baseline`);
      }
      const contains = check.contains === undefined ? undefined : nonEmptyString(check.contains, "contains");
      const notContains = check.notContains === undefined
        ? undefined
        : nonEmptyString(check.notContains, "notContains");
      if (contains === undefined && notContains === undefined) {
        throw new ConfigError(`functionalChecks[${index}] needs contains or notContains`);
      }
      return {
        target: check.target as "cache" | "baseline",
        under: assertSafeRelativePath(nonEmptyString(check.under, "under"), "under"),
        ...(contains === undefined ? {} : { contains }),
        ...(notContains === undefined ? {} : { notContains }),
      };
    },
  );

  let normalization: VerificationConfig["normalization"];
  if (root.normalization !== undefined) {
    const policy = object(root.normalization, "normalization");
    const omit = policy.omit === undefined ? undefined : array(policy.omit, "normalization.omit").map((entry, index) => {
      const rule = object(entry, `normalization.omit[${index}]`);
      return {
        path: assertSafeRelativePath(nonEmptyString(rule.path, "path"), "normalization path"),
        reason: nonEmptyString(rule.reason, "reason"),
      };
    });
    const replaceLiterals = policy.replaceLiterals === undefined
      ? undefined
      : array(policy.replaceLiterals, "normalization.replaceLiterals").map((entry, index) => {
        const rule = object(entry, `normalization.replaceLiterals[${index}]`);
        return {
          path: assertSafeRelativePath(nonEmptyString(rule.path, "path"), "normalization path"),
          search: nonEmptyString(rule.search, "search"),
          replacement: nonEmptyString(rule.replacement, "replacement"),
          reason: nonEmptyString(rule.reason, "reason"),
        };
      });
    normalization = {
      id: nonEmptyString(policy.id, "normalization.id"),
      description: nonEmptyString(policy.description, "normalization.description"),
      ...(omit === undefined ? {} : { omit }),
      ...(replaceLiterals === undefined ? {} : { replaceLiterals }),
    };
  }

  let preparedFault: VerificationConfig["preparedFault"];
  if (root.preparedFault !== undefined) {
    const fault = object(root.preparedFault, "preparedFault");
    if (fault.kind !== "intentional-input-exclusion") throw new ConfigError("unsupported prepared fault");
    preparedFault = {
      kind: fault.kind,
      description: nonEmptyString(fault.description, "preparedFault.description"),
      configFiles: strings(fault.configFiles, "preparedFault.configFiles").map((path) =>
        assertSafeRelativePath(path, "preparedFault.configFiles")),
    };
  }

  const functionalSignals = (checks ?? []).flatMap((check) =>
    [check.contains, check.notContains].filter((signal): signal is string => signal !== undefined));
  for (const rule of normalization?.replaceLiterals ?? []) {
    if (functionalSignals.some((signal) => rule.search.includes(signal) || signal.includes(rule.search))) {
      throw new ConfigError("normalization cannot replace a functional-check signal");
    }
  }

  return {
    schemaVersion: "1", id, projectRoot, evidenceFile, install, turbo, tasks, outputs, mutation,
    ...(checks === undefined ? {} : { functionalChecks: checks }),
    ...(normalization === undefined ? {} : { normalization }),
    ...(preparedFault === undefined ? {} : { preparedFault }),
  };
}
