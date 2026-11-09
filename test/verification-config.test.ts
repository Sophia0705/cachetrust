import { describe, expect, it } from "vitest";
import { validateVerificationConfig } from "../src/verification/config.js";

function config() {
  return {
    schemaVersion: "1",
    id: "test",
    projectRoot: "target",
    evidenceFile: "evidence.json",
    install: {
      command: "node", commandArgs: ["pnpm.mjs"], versionArgs: ["--version"],
      args: ["install", "--frozen-lockfile"], packageManager: "pnpm",
      packageManagerVersion: "11.25.0", lockfiles: ["pnpm-lock.yaml"], timeoutMs: 1_000,
    },
    turbo: { command: "turbo", task: "build", version: "2.10.12", timeoutMs: 1_000 },
    tasks: [{ id: "app#build", expectedAfterMutation: "HIT" }],
    outputs: [{ taskId: "app#build", include: ["apps/app/dist/**"] }],
    mutation: { kind: "none" },
  };
}

describe("verification config", () => {
  it("accepts the minimal frozen-install contract", () => {
    expect(validateVerificationConfig(config())).toMatchObject({ id: "test", mutation: { kind: "none" } });
  });

  it("accepts string install environment overrides and preserves omission", () => {
    expect(validateVerificationConfig(config()).install.environment).toBeUndefined();
    const value = config();
    (value.install as Record<string, unknown>).environment = { NODE_ENV: "production", EMPTY: "" };
    expect(validateVerificationConfig(value).install.environment).toEqual({ NODE_ENV: "production", EMPTY: "" });
  });

  it("rejects invalid install environment names and values", () => {
    const invalidName = config();
    (invalidName.install as Record<string, unknown>).environment = { "BAD=NAME": "value" };
    expect(() => validateVerificationConfig(invalidName)).toThrow("invalid environment variable name");

    const invalidValue = config() as Record<string, any>;
    invalidValue.install.environment = { TOKEN: 123 };
    expect(() => validateVerificationConfig(invalidValue)).toThrow("values must be strings");
  });

  it("rejects installs without frozen lockfile semantics", () => {
    const value = config();
    value.install.args = ["install"];
    expect(() => validateVerificationConfig(value)).toThrow("frozen lockfile");
  });

  it("rejects traversal in mutation and output paths", () => {
    const mutation = config() as Record<string, any>;
    mutation.mutation = {
      kind: "replace-file", path: "../outside", replacementFile: "replacement",
      expectedBeforeSha256: "before", expectedAfterSha256: "after",
    };
    expect(() => validateVerificationConfig(mutation)).toThrow("escapes");

    const output = config();
    output.outputs[0]!.include = ["../outside/**"];
    expect(() => validateVerificationConfig(output)).toThrow("escapes");
  });

  it("rejects arbitrary wildcard and regex-like output patterns", () => {
    const value = config();
    value.outputs[0]!.include = ["apps/*/dist/**"];
    expect(() => validateVerificationConfig(value)).toThrow("only literal paths");
  });

  it("rejects arbitrary normalization patterns", () => {
    const value = config() as Record<string, any>;
    value.normalization = {
      id: "unsafe", description: "unsafe", replaceLiterals: [{
        path: "dist/a.js", pattern: ".*", replacement: "", reason: "broad",
      }],
    };
    expect(() => validateVerificationConfig(value)).toThrow("unsupported field: pattern");
  });

  it("rejects normalization that can erase a functional signal", () => {
    const value = config() as Record<string, any>;
    value.functionalChecks = [{ target: "baseline", under: "dist", contains: "MUTATED" }];
    value.normalization = {
      id: "unsafe", description: "unsafe", replaceLiterals: [{
        path: "dist/a.js", search: "MUTATED", replacement: "<value>", reason: "bad rule",
      }],
    };
    expect(() => validateVerificationConfig(value)).toThrow("functional-check signal");
  });

  it("rejects evidence inside the target and unknown fields", () => {
    const inside = config();
    inside.evidenceFile = "target/evidence.json";
    expect(() => validateVerificationConfig(inside)).toThrow("outside projectRoot");

    const unknown = { ...config(), futureOption: true };
    expect(() => validateVerificationConfig(unknown)).toThrow("unsupported field: futureOption");
  });
});
