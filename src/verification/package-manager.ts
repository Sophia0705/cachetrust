import { access, readFile, realpath } from "node:fs/promises";
import { basename, extname, isAbsolute, resolve } from "node:path";
import { runProcess, type ProcessResult } from "../process.js";
import type { VerificationConfig } from "./config.js";

export interface ResolvedInvocation {
  command: string;
  args: string[];
}

export interface PackageManagerProbe {
  name: string;
  expectedVersion: string;
  observedVersion: string;
  executable: string;
  process: ProcessResult;
  install: ResolvedInvocation;
}

export class PackageManagerError extends Error {
  constructor(
    readonly reasonCode: string,
    message: string,
    readonly observedVersion?: string,
    readonly executable?: string,
    readonly processResult?: ProcessResult,
  ) {
    super(message);
  }
}

function isPath(value: string): boolean {
  return isAbsolute(value) || value.includes("/") || value.includes("\\");
}

async function resolveExecutable(command: string, cwd: string, signal?: AbortSignal): Promise<string> {
  if (isPath(command)) {
    const path = isAbsolute(command) ? command : resolve(cwd, command);
    await access(path).catch(() => {
      throw new PackageManagerError("PACKAGE_MANAGER_NOT_FOUND", "Package-manager executable was not found");
    });
    return realpath(path);
  }
  const locator = process.platform === "win32"
    ? await runProcess("where.exe", [command], { cwd, timeoutMs: 10_000, ...(signal === undefined ? {} : { signal }) })
    : await runProcess("which", [command], { cwd, timeoutMs: 10_000, ...(signal === undefined ? {} : { signal }) });
  if (locator.exitCode !== 0 || locator.timedOut) {
    throw new PackageManagerError("PACKAGE_MANAGER_NOT_FOUND", "Package-manager executable was not found");
  }
  const path = locator.stdout.split(/\r?\n/).map((line) => line.trim()).find(Boolean);
  if (path === undefined) throw new PackageManagerError("PACKAGE_MANAGER_NOT_FOUND", "Package-manager executable was not found");
  return realpath(path);
}

export function invocationFor(executable: string, args: readonly string[]): ResolvedInvocation {
  const extension = extname(executable).toLowerCase();
  if (process.platform === "win32" && (extension === ".cmd" || extension === ".bat")) {
    return {
      command: process.env.ComSpec ?? "cmd.exe",
      args: ["/d", "/c", "call", executable, ...args],
    };
  }
  return { command: executable, args: [...args] };
}

async function declaredPackageManager(projectRoot: string): Promise<string | undefined> {
  let source: string;
  try {
    source = await readFile(resolve(projectRoot, "package.json"), "utf8");
  } catch (error) {
    if (typeof error === "object" && error !== null && "code" in error
        && (error as { code?: unknown }).code === "ENOENT") return undefined;
    throw new PackageManagerError("PACKAGE_MANAGER_DECLARATION_INVALID", "Unable to read target package.json");
  }
  let value: unknown;
  try {
    value = JSON.parse(source) as unknown;
  } catch {
    throw new PackageManagerError("PACKAGE_MANAGER_DECLARATION_INVALID", "Target package.json is malformed");
  }
  if (typeof value !== "object" || value === null) {
    throw new PackageManagerError("PACKAGE_MANAGER_DECLARATION_INVALID", "Target package.json is invalid");
  }
  const declaration = (value as Record<string, unknown>).packageManager;
  if (declaration === undefined) return undefined;
  if (typeof declaration !== "string") {
    throw new PackageManagerError("PACKAGE_MANAGER_DECLARATION_INVALID", "packageManager must be a string");
  }
  return declaration;
}

function declarationMatches(declared: string, name: string, version: string): boolean {
  const separator = declared.lastIndexOf("@");
  if (separator <= 0) return false;
  return declared.slice(0, separator) === name
    && declared.slice(separator + 1).split("+")[0] === version;
}

export async function probePackageManager(
  config: VerificationConfig,
  signal?: AbortSignal,
): Promise<PackageManagerProbe> {
  const declared = await declaredPackageManager(config.projectRoot);
  const expectedDeclaration = `${config.install.packageManager}@${config.install.packageManagerVersion}`;
  if (declared !== undefined && !declarationMatches(
    declared, config.install.packageManager, config.install.packageManagerVersion,
  )) {
    throw new PackageManagerError(
      "PACKAGE_MANAGER_DECLARATION_MISMATCH",
      `Target declares ${declared}, but configuration expects ${expectedDeclaration}`,
    );
  }
  const executable = await resolveExecutable(config.install.command, config.projectRoot, signal);
  const prefix = config.install.commandArgs ?? [];
  const versionInvocation = invocationFor(executable, [...prefix, ...config.install.versionArgs]);
  let processResult: ProcessResult;
  try {
    processResult = await runProcess(versionInvocation.command, versionInvocation.args, {
      cwd: config.projectRoot,
      timeoutMs: Math.min(config.install.timeoutMs, 30_000),
      ...(signal === undefined ? {} : { signal }),
    });
  } catch {
    throw new PackageManagerError("PACKAGE_MANAGER_NOT_FOUND", "Package-manager version probe could not start");
  }
  if (signal?.aborted === true) throw new PackageManagerError("CANCELLED", "Verification was cancelled");
  if (processResult.exitCode !== 0 || processResult.timedOut) {
    throw new PackageManagerError(
      "PACKAGE_MANAGER_VERSION_UNAVAILABLE", "Package-manager version probe failed",
      undefined, basename(executable), processResult,
    );
  }
  const observedVersion = processResult.stdout.trim().split(/\r?\n/)[0]?.replace(/^v/, "");
  if (observedVersion === undefined || observedVersion.length === 0) {
    throw new PackageManagerError(
      "PACKAGE_MANAGER_VERSION_UNAVAILABLE", "Package-manager version was empty",
      undefined, basename(executable), processResult,
    );
  }
  if (observedVersion !== config.install.packageManagerVersion) {
    throw new PackageManagerError(
      "PACKAGE_MANAGER_VERSION_MISMATCH",
      `Expected ${config.install.packageManagerVersion}, observed ${observedVersion}`,
      observedVersion,
      basename(executable),
      processResult,
    );
  }
  return {
    name: config.install.packageManager,
    expectedVersion: config.install.packageManagerVersion,
    observedVersion,
    executable: basename(executable),
    process: processResult,
    install: invocationFor(executable, [...prefix, ...config.install.args]),
  };
}
