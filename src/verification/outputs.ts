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
  transformations?: Array<{
    path: string;
    kind: "omit" | "replace-literal" | "derive-literal";
    reason: string;
  }>;
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
  const derived = await Promise.all((policy.deriveLiterals ?? []).map(async (rule) => {
    const source = await readFile(resolveInside(workspace, rule.sourcePath), "utf8");
    let literal: unknown = source.trim();
    if (rule.jsonPointer !== undefined) {
      literal = rule.jsonPointer.slice(1).split("/").reduce<unknown>((value, token) => {
        const key = token.replaceAll("~1", "/").replaceAll("~0", "~");
        if (typeof value !== "object" || value === null || !(key in value)) {
          throw new Error(`Normalization JSON pointer not found in ${rule.sourcePath}`);
        }
        return (value as Record<string, unknown>)[key];
      }, JSON.parse(source));
    }
    if (typeof literal !== "string" || literal.length === 0) {
      throw new Error(`Normalization source is not a non-empty string: ${rule.sourcePath}`);
    }
    return { ...rule, literal };
  }));
  const entries: ManifestEntry[] = [];
  const transformations: NonNullable<OutputManifest["transformations"]> = [];
  for (const entry of raw.entries) {
    const omission = omissions.get(entry.path);
    if (omission !== undefined) {
      transformations.push({ path: entry.path, kind: "omit", reason: omission });
      continue;
    }
    const replacement = replacements.get(entry.path);
    const applicable = derived.filter((rule) => matches(entry.path, rule.target));
    if (replacement === undefined && applicable.length === 0) {
      entries.push(entry);
      continue;
    }
    const bytes = await readFile(resolveInside(workspace, entry.path));
    let text: string | undefined;
    try {
      text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    } catch {
      if (replacement !== undefined) throw new Error(`Normalization target is not UTF-8: ${entry.path}`);
    }
    if (replacement !== undefined && !text!.includes(replacement.search)) {
      throw new Error(`Normalization literal not found in ${entry.path}`);
    }
    let normalized = replacement === undefined ? text : text!.replaceAll(replacement.search, replacement.replacement);
    let normalizedPath = entry.path;
    if (replacement !== undefined) {
      transformations.push({ path: entry.path, kind: "replace-literal", reason: replacement.reason });
    }
    for (const rule of applicable) {
      let changed = false;
      const literals = [
        rule.literal,
        ...(rule.jsonStringEncoded === true ? [JSON.stringify(rule.literal).slice(1, -1)] : []),
      ];
      for (const literal of [...new Set(literals)]) {
        if (normalized?.includes(literal)) {
          normalized = normalized.replaceAll(literal, rule.replacement);
          changed = true;
        }
      }
      if (rule.replaceInPath === true && normalizedPath.includes(rule.literal)) {
        normalizedPath = normalizedPath.replaceAll(rule.literal, rule.replacement);
        changed = true;
      }
      if (changed) {
        transformations.push({ path: entry.path, kind: "derive-literal", reason: rule.reason });
      }
    }
    entries.push({
      path: normalizedPath,
      bytes: normalized === undefined ? entry.bytes : Buffer.byteLength(normalized),
      sha256: normalized === undefined
        ? entry.sha256
        : createHash("sha256").update(normalized).digest("hex"),
    });
  }
  entries.sort((left, right) => left.path.localeCompare(right.path));
  if (new Set(entries.map((entry) => entry.path)).size !== entries.length) {
    throw new Error("Normalization produced duplicate output paths");
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
