import { createHash } from "node:crypto";
import { lstat, readdir, readFile, rm } from "node:fs/promises";
import { relative, resolve, sep } from "node:path";
import { fingerprintFile } from "../fingerprint.js";
import { resolveInside, type VerificationConfig } from "./config.js";

export interface ManifestEntry {
  path: string;
  bytes: number;
  sha256: string;
}

export interface OutputManifest {
  entries: ManifestEntry[];
  sha256: string;
  normalizedBy?: string;
  transformations?: Array<{ path: string; kind: "omit" | "replace-literal"; reason: string }>;
}

function portable(root: string, path: string): string {
  return relative(root, path).split(sep).join("/");
}

function patternRoot(pattern: string): string {
  return pattern.endsWith("/**") ? pattern.slice(0, -3) : pattern;
}

function matches(path: string, pattern: string): boolean {
  const root = patternRoot(pattern);
  return path === root || (pattern.endsWith("/**") && path.startsWith(`${root}/`));
}

async function filesUnder(root: string, path: string): Promise<string[]> {
  const stat = await lstat(path).catch(() => undefined);
  if (stat === undefined) return [];
  if (stat.isSymbolicLink()) throw new Error(`Output link is unsupported: ${portable(root, path)}`);
  if (stat.isFile()) return [path];
  if (!stat.isDirectory()) return [];
  const files: string[] = [];
  for (const entry of await readdir(path)) files.push(...await filesUnder(root, resolve(path, entry)));
  return files;
}

function manifestHash(entries: readonly ManifestEntry[]): string {
  return createHash("sha256").update(JSON.stringify(entries)).digest("hex");
}

export async function fingerprintOutputs(
  workspace: string,
  outputs: VerificationConfig["outputs"],
): Promise<OutputManifest> {
  const includes = [...new Set(outputs.flatMap((output) => output.include))];
  const excludes = [...new Set(outputs.flatMap((output) => output.exclude ?? []))];
  const paths = new Set<string>();
  for (const include of includes) {
    const root = resolveInside(workspace, patternRoot(include), "output include");
    for (const path of await filesUnder(workspace, root)) {
      const name = portable(workspace, path);
      if (!excludes.some((pattern) => matches(name, pattern))) paths.add(path);
    }
  }
  const entries: ManifestEntry[] = [];
  for (const path of [...paths].sort()) {
    const stat = await lstat(path);
    entries.push({ path: portable(workspace, path), bytes: stat.size, sha256: await fingerprintFile(path) });
  }
  return { entries, sha256: manifestHash(entries) };
}

export async function cleanOutputs(
  workspace: string,
  outputs: VerificationConfig["outputs"],
): Promise<string[]> {
  const roots = [...new Set(outputs.flatMap((output) => output.include).map(patternRoot))];
  for (const root of roots) {
    await rm(resolveInside(workspace, root, "output root"), { recursive: true, force: true });
  }
  return roots;
}

export async function normalizeManifest(
  workspace: string,
  raw: OutputManifest,
  policy: NonNullable<VerificationConfig["normalization"]>,
): Promise<OutputManifest> {
  const omissions = new Map((policy.omit ?? []).map((rule) => [rule.path, rule.reason]));
  const replacements = new Map((policy.replaceLiterals ?? []).map((rule) => [rule.path, rule]));
  const entries: ManifestEntry[] = [];
  const transformations: NonNullable<OutputManifest["transformations"]> = [];
  for (const entry of raw.entries) {
    const omission = omissions.get(entry.path);
    if (omission !== undefined) {
      transformations.push({ path: entry.path, kind: "omit", reason: omission });
      continue;
    }
    const replacement = replacements.get(entry.path);
    if (replacement === undefined) {
      entries.push(entry);
      continue;
    }
    const bytes = await readFile(resolveInside(workspace, entry.path));
    const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    if (!text.includes(replacement.search)) {
      throw new Error(`Normalization literal not found in ${entry.path}`);
    }
    const normalized = text.replaceAll(replacement.search, replacement.replacement);
    entries.push({
      path: entry.path,
      bytes: Buffer.byteLength(normalized),
      sha256: createHash("sha256").update(normalized).digest("hex"),
    });
    transformations.push({ path: entry.path, kind: "replace-literal", reason: replacement.reason });
  }
  return { entries, sha256: manifestHash(entries), normalizedBy: policy.id, transformations };
}

export interface FunctionalCheckResult {
  target: "cache" | "baseline";
  under: string;
  passed: boolean;
  matchedFiles: string[];
}

export async function runFunctionalChecks(
  workspace: string,
  checks: NonNullable<VerificationConfig["functionalChecks"]>,
  target: "cache" | "baseline",
): Promise<FunctionalCheckResult[]> {
  const results: FunctionalCheckResult[] = [];
  for (const check of checks.filter((value) => value.target === target)) {
    const files = await filesUnder(workspace, resolveInside(workspace, check.under, "functional check root"));
    const containsMatches: string[] = [];
    const forbiddenMatches: string[] = [];
    for (const file of files) {
      const content = await readFile(file).catch(() => undefined);
      if (content === undefined) continue;
      const text = new TextDecoder("utf-8", { fatal: false }).decode(content);
      if (check.contains !== undefined && text.includes(check.contains)) {
        containsMatches.push(portable(workspace, file));
      }
      if (check.notContains !== undefined && text.includes(check.notContains)) {
        forbiddenMatches.push(portable(workspace, file));
      }
    }
    const passed = (check.contains === undefined || containsMatches.length > 0)
      && (check.notContains === undefined || forbiddenMatches.length === 0);
    results.push({
      target,
      under: check.under,
      passed,
      matchedFiles: check.contains === undefined
        ? files.map((file) => portable(workspace, file))
        : containsMatches,
    });
  }
  return results;
}
