import { copyFile, readFile, writeFile } from "node:fs/promises";
import { fingerprintFile } from "../fingerprint.js";
import { resolveInside, type VerificationConfig } from "./config.js";

export interface MutationResult {
  kind: "none" | "replace-file";
  path?: string;
  beforeSha256?: string;
  afterSha256?: string;
}

export async function applyMutation(
  workspace: string,
  mutation: VerificationConfig["mutation"],
): Promise<MutationResult> {
  if (mutation.kind === "none") return { kind: "none" };
  const target = resolveInside(workspace, mutation.path, "mutation.path");
  const beforeSha256 = await fingerprintFile(target);
  if (beforeSha256 !== mutation.expectedBeforeSha256) {
    throw new Error(`Mutation precondition mismatch for ${mutation.path}`);
  }
  const replacementSha256 = await fingerprintFile(mutation.replacementFile);
  if (replacementSha256 !== mutation.expectedAfterSha256) {
    throw new Error("Replacement file hash does not match expectedAfterSha256");
  }
  await copyFile(mutation.replacementFile, target);
  const afterSha256 = await fingerprintFile(target);
  if (afterSha256 !== mutation.expectedAfterSha256) throw new Error("Mutation verification failed");
  return { kind: "replace-file", path: mutation.path, beforeSha256, afterSha256 };
}

export async function restoreMutation(
  workspace: string,
  mutation: VerificationConfig["mutation"],
  original: Uint8Array | undefined,
): Promise<boolean> {
  if (mutation.kind === "none") return true;
  if (original === undefined) return false;
  const target = resolveInside(workspace, mutation.path, "mutation.path");
  await writeFile(target, original);
  return await fingerprintFile(target) === mutation.expectedBeforeSha256;
}

export async function captureMutationOriginal(
  workspace: string,
  mutation: VerificationConfig["mutation"],
): Promise<Uint8Array | undefined> {
  return mutation.kind === "none"
    ? undefined
    : readFile(resolveInside(workspace, mutation.path, "mutation.path"));
}
