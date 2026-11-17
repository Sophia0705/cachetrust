import { cp, lstat, mkdir, mkdtemp, readdir, realpath, rm } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fingerprintFile } from "../fingerprint.js";
import { runProcess, type ProcessResult } from "../process.js";
import { resolveInside, type VerificationConfig } from "./config.js";
import { installEnvironment, type ResolvedInvocation } from "./package-manager.js";

export interface VerificationWorkspace {
  id: "cache" | "baseline-a" | "baseline-b";
  project: string;
  cache: string;
  install?: ProcessResult;
}

export interface VerificationIsolation {
  root: string;
  workspaces: [VerificationWorkspace, VerificationWorkspace, VerificationWorkspace];
  lockfileSha256: Record<string, string>;
  lifecycle: Array<{
    workspace: VerificationWorkspace["id"];
    fixedProjectPath: boolean;
    slotAbsentAfterRemoval: boolean;
    sourceCopied: boolean;
    installSucceeded: boolean;
    lockfileVerified: boolean;
  }>;
  activate(id: VerificationWorkspace["id"]): Promise<VerificationWorkspace>;
  cleanup(): Promise<void>;
}

export class IsolationError extends Error {
  readonly reasonCode: string;
  constructor(reasonCode: string, message: string) {
    super(message);
    this.reasonCode = reasonCode;
  }
}

function isAborted(signal: AbortSignal | undefined): boolean {
  return signal?.aborted ?? false;
}

function isDescendant(root: string, path: string): boolean {
  const value = relative(resolve(root), resolve(path));
  return value.length > 0 && value !== ".." && !value.startsWith(`..${sep}`) && !isAbsolute(value);
}

export function assertOwnedPath(root: string, path: string): void {
  if (!isDescendant(root, path)) throw new IsolationError("UNSAFE_WORKSPACE", "Path escapes owned root");
}

export function assertContainedLinkTarget(root: string, target: string): void {
  const resolvedRoot = resolve(root);
  const resolvedTarget = resolve(target);
  if (resolvedTarget !== resolvedRoot && !isDescendant(resolvedRoot, resolvedTarget)) {
    throw new IsolationError("UNSAFE_DEPENDENCY_LINK", "Dependency link escapes its workspace");
  }
}

function excludedRelativePath(path: string, outputRoots: readonly string[]): boolean {
  const portable = path.split(sep).join("/");
  const parts = portable.split("/");
  return parts.includes(".git") || parts.includes("node_modules") || parts.includes(".turbo")
    || outputRoots.some((root) => portable === root || portable.startsWith(`${root}/`));
}

async function assertNoProjectLinks(
  projectRoot: string,
  directory: string,
  outputRoots: readonly string[],
): Promise<void> {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    const rel = relative(projectRoot, path);
    if (excludedRelativePath(rel, outputRoots)) continue;
    const stat = await lstat(path);
    if (stat.isSymbolicLink()) {
      await realpath(path).catch(() => undefined);
      throw new IsolationError("UNSAFE_PROJECT_LINK", `Project link is unsupported: ${rel}`);
    }
    if (stat.isDirectory()) await assertNoProjectLinks(projectRoot, path, outputRoots);
  }
}

async function assertInstalledLinksContained(projectRoot: string, directory: string): Promise<void> {
  const entries = await readdir(directory, { withFileTypes: true }).catch(() => []);
  for (const entry of entries) {
    const path = join(directory, entry.name);
    const stat = await lstat(path);
    if (stat.isSymbolicLink()) {
      const target = await realpath(path).catch(() => {
        throw new IsolationError("UNSAFE_DEPENDENCY_LINK", "Dependency link cannot be resolved");
      });
      assertContainedLinkTarget(projectRoot, target);
      continue;
    }
    if (stat.isDirectory()) await assertInstalledLinksContained(projectRoot, path);
  }
}

export async function assertCleanGitProject(projectRoot: string, signal?: AbortSignal): Promise<string> {
  const status = await runProcess("git", ["status", "--porcelain=v1", "--untracked-files=all"], {
    cwd: projectRoot,
    timeoutMs: 10_000,
    ...(signal === undefined ? {} : { signal }),
  });
  if (isAborted(signal)) throw new IsolationError("CANCELLED", "Verification was cancelled");
  if (status.exitCode !== 0) throw new IsolationError("GIT_STATUS_FAILED", "Unable to inspect Git state");
  if (status.stdout.trim().length > 0) {
    throw new IsolationError("DIRTY_REPOSITORY", "Repository must be clean before verification");
  }
  const commit = await runProcess("git", ["rev-parse", "HEAD"], {
    cwd: projectRoot, timeoutMs: 10_000, ...(signal === undefined ? {} : { signal }),
  });
  if (isAborted(signal)) throw new IsolationError("CANCELLED", "Verification was cancelled");
  if (commit.exitCode !== 0) throw new IsolationError("GIT_STATUS_FAILED", "Unable to resolve Git commit");
  return commit.stdout.trim();
}

async function lockfileHashes(root: string, lockfiles: readonly string[]): Promise<Record<string, string>> {
  const hashes: Record<string, string> = {};
  for (const lockfile of lockfiles) hashes[lockfile] = await fingerprintFile(resolveInside(root, lockfile));
  return hashes;
}

function equalHashes(left: Record<string, string>, right: Record<string, string>): boolean {
  return Object.keys(left).length === Object.keys(right).length
    && Object.entries(left).every(([path, hash]) => right[path] === hash);
}

export async function createVerificationIsolation(
  config: VerificationConfig,
  installInvocation: ResolvedInvocation = {
    command: config.install.command,
    args: [...(config.install.commandArgs ?? []), ...config.install.args],
  },
  signal?: AbortSignal,
): Promise<VerificationIsolation> {
  const outputRoots = [...new Set(config.outputs.flatMap((output) => output.include)
    .map((pattern) => pattern.endsWith("/**") ? pattern.slice(0, -3) : pattern))];
  await assertNoProjectLinks(config.projectRoot, config.projectRoot, outputRoots);
  const beforeLocks = await lockfileHashes(config.projectRoot, config.install.lockfiles);
  const root = await mkdtemp(join(dirname(config.projectRoot), ".cachetrust-verify-"));
  const definitions = ["cache", "baseline-a", "baseline-b"] as const;
  const workspaces: VerificationWorkspace[] = [];
  const lifecycle: VerificationIsolation["lifecycle"] = [];
  try {
    if (config.workspaceStrategy === "fixed-path-sequential") {
      const project = join(root, "slot", "project");
      const caches = join(root, "caches");
      await mkdir(caches);
      for (const id of definitions) {
        const cache = join(caches, id);
        assertOwnedPath(root, cache);
        await mkdir(cache);
        workspaces.push({ id, project, cache });
      }
      let active: VerificationWorkspace["id"] | undefined;
      const activate = async (id: VerificationWorkspace["id"]): Promise<VerificationWorkspace> => {
        const workspace = workspaces.find((value) => value.id === id)!;
        if (active === id) return workspace;
        const slot = dirname(project);
        assertOwnedPath(root, slot);
        await rm(slot, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
        const slotAbsentAfterRemoval = await lstat(slot).then(() => false, () => true);
        if (!slotAbsentAfterRemoval) throw new IsolationError("UNSAFE_WORKSPACE", "Fixed slot removal was incomplete");
        await mkdir(slot, { recursive: true });
        await cp(config.projectRoot, project, {
          recursive: true,
          errorOnExist: true,
          filter: (source) => source === config.projectRoot
            || !excludedRelativePath(relative(config.projectRoot, source), outputRoots),
        });
        const install = await runProcess(installInvocation.command, installInvocation.args, {
          cwd: project,
          env: installInvocation.env ?? installEnvironment(config),
          timeoutMs: config.install.timeoutMs,
          ...(signal === undefined ? {} : { signal }),
        });
        if (isAborted(signal)) throw new IsolationError("CANCELLED", "Verification was cancelled");
        if (install.exitCode !== 0 || install.timedOut) {
          throw new IsolationError("DEPENDENCY_INSTALL_FAILED", `Dependency install failed in ${id}`);
        }
        const afterLocks = await lockfileHashes(project, config.install.lockfiles);
        if (!equalHashes(beforeLocks, afterLocks)) {
          throw new IsolationError("LOCKFILE_CHANGED", `Frozen install changed a lockfile in ${id}`);
        }
        await assertInstalledLinksContained(project, join(project, "node_modules"));
        workspace.install = install;
        lifecycle.push({
          workspace: id,
          fixedProjectPath: true,
          slotAbsentAfterRemoval,
          sourceCopied: true,
          installSucceeded: true,
          lockfileVerified: true,
        });
        active = id;
        return workspace;
      };
      return {
        root,
        workspaces: workspaces as VerificationIsolation["workspaces"],
        lockfileSha256: beforeLocks,
        lifecycle,
        activate,
        cleanup: async () => {
          if (!root.startsWith(`${dirname(config.projectRoot)}${sep}.cachetrust-verify-`)) {
            throw new IsolationError("UNSAFE_CLEANUP", "Refusing to remove unowned path");
          }
          await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
        },
      };
    }
    for (const id of definitions) {
      const project = join(root, id, "project");
      const cache = join(root, id, "turbo-cache");
      assertOwnedPath(root, project);
      assertOwnedPath(root, cache);
      await mkdir(dirname(project), { recursive: true });
      await cp(config.projectRoot, project, {
        recursive: true,
        errorOnExist: true,
        filter: (source) => {
          if (source === config.projectRoot) return true;
          return !excludedRelativePath(relative(config.projectRoot, source), outputRoots);
        },
      });
      await mkdir(cache);
      const install = await runProcess(installInvocation.command, installInvocation.args, {
        cwd: project,
        env: installInvocation.env ?? installEnvironment(config),
        timeoutMs: config.install.timeoutMs,
        ...(signal === undefined ? {} : { signal }),
      });
      if (isAborted(signal)) throw new IsolationError("CANCELLED", "Verification was cancelled");
      if (install.exitCode !== 0 || install.timedOut) {
        throw new IsolationError("DEPENDENCY_INSTALL_FAILED", `Dependency install failed in ${id}`);
      }
      const afterLocks = await lockfileHashes(project, config.install.lockfiles);
      if (!equalHashes(beforeLocks, afterLocks)) {
        throw new IsolationError("LOCKFILE_CHANGED", `Frozen install changed a lockfile in ${id}`);
      }
      await assertInstalledLinksContained(project, join(project, "node_modules"));
      workspaces.push({ id, project, cache, install });
    }
    return {
      root,
      workspaces: workspaces as VerificationIsolation["workspaces"],
      lockfileSha256: beforeLocks,
      lifecycle,
      activate: async (id) => workspaces.find((workspace) => workspace.id === id)!,
      cleanup: async () => {
        if (!root.startsWith(`${dirname(config.projectRoot)}${sep}.cachetrust-verify-`)) {
          throw new IsolationError("UNSAFE_CLEANUP", "Refusing to remove unowned path");
        }
        await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
      },
    };
  } catch (error) {
    await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    throw error;
  }
}
