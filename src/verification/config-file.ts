import { readFile } from "node:fs/promises";
import { dirname, isAbsolute, resolve } from "node:path";
import { validateVerificationConfig, type VerificationConfig } from "./config.js";

export class ConfigFileError extends Error {
  constructor(readonly reasonCode: "CONFIG_UNREADABLE" | "MALFORMED_JSON", message: string) {
    super(message);
  }
}

function pathFrom(base: string, value: unknown): unknown {
  if (typeof value !== "string" || isAbsolute(value)) return value;
  return resolve(base, value);
}

function executableFrom(base: string, value: unknown): unknown {
  if (typeof value !== "string" || isAbsolute(value)
      || (!value.includes("/") && !value.includes("\\"))) return value;
  return resolve(base, value);
}

export async function loadVerificationConfig(
  configPath: string,
  cwd = process.cwd(),
): Promise<{ path: string; config: VerificationConfig }> {
  const path = resolve(cwd, configPath);
  let source: string;
  try {
    source = await readFile(path, "utf8");
  } catch {
    throw new ConfigFileError("CONFIG_UNREADABLE", "Configuration file is missing or unreadable");
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(source) as unknown;
  } catch {
    throw new ConfigFileError("MALFORMED_JSON", "Configuration file contains malformed JSON");
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return { path, config: validateVerificationConfig(parsed) };
  }
  const base = dirname(path);
  const raw = { ...(parsed as Record<string, unknown>) };
  raw.projectRoot = pathFrom(base, raw.projectRoot);
  raw.evidenceFile = pathFrom(base, raw.evidenceFile);
  if (typeof raw.install === "object" && raw.install !== null && !Array.isArray(raw.install)) {
    const install = { ...(raw.install as Record<string, unknown>) };
    install.command = executableFrom(base, install.command);
    raw.install = install;
  }
  if (typeof raw.turbo === "object" && raw.turbo !== null && !Array.isArray(raw.turbo)) {
    const turbo = { ...(raw.turbo as Record<string, unknown>) };
    turbo.command = executableFrom(base, turbo.command);
    raw.turbo = turbo;
  }
  if (typeof raw.mutation === "object" && raw.mutation !== null && !Array.isArray(raw.mutation)) {
    const mutation = { ...(raw.mutation as Record<string, unknown>) };
    if (mutation.replacementFile !== undefined) {
      mutation.replacementFile = pathFrom(base, mutation.replacementFile);
    }
    raw.mutation = mutation;
  }
  const config = validateVerificationConfig(raw);
  if (resolve(config.evidenceFile) === path) {
    throw new ConfigFileError("CONFIG_UNREADABLE", "evidenceFile cannot overwrite the configuration file");
  }
  return { path, config };
}
