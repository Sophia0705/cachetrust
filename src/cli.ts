#!/usr/bin/env node
import { Command, CommanderError } from "commander";
import { mkdir, writeFile } from "node:fs/promises";
import { basename, dirname, relative } from "node:path";
import { pathToFileURL } from "node:url";
import { scenarios, type Scenario, type ScenarioResult } from "./scenario.js";
import { ConfigError, type VerificationStatus } from "./verification/config.js";
import { ConfigFileError, loadVerificationConfig } from "./verification/config-file.js";
import { verifyProject } from "./verification/engine.js";

export interface CliIo {
  out(message: string): void;
  error(message: string): void;
}

export function exitCodeFor(results: readonly ScenarioResult[]): number {
  if (results.some((result) => result.status === "ENVIRONMENT_ERROR")) return 3;
  if (results.some((result) => result.status === "INCONCLUSIVE")) return 2;
  if (results.some((result) => result.status === "STALE_HIT" || result.status === "UNSAFE_SAVE")) return 1;
  return 0;
}

export function exitCodeForVerification(status: VerificationStatus): number {
  if (status === "ENVIRONMENT_ERROR") return 3;
  if (status === "INCONCLUSIVE") return 2;
  if (status === "MISMATCH") return 1;
  return 0;
}

export interface CliServices {
  loadConfig: typeof loadVerificationConfig;
  verify: typeof verifyProject;
}

const defaultServices: CliServices = { loadConfig: loadVerificationConfig, verify: verifyProject };

const defaultIo: CliIo = {
  out: (message) => console.log(message),
  error: (message) => console.error(message),
};

export function createCli(
  registeredScenarios: readonly Scenario[] = scenarios,
  io: CliIo = defaultIo,
  services: CliServices = defaultServices,
): Command {
  const program = new Command()
    .name("cachetrust")
    .description("Verify build-cache correctness with repeatable scenarios")
    .version("0.1.0")
    .showHelpAfterError()
    .configureOutput({
      writeOut: (text) => io.out(text.trimEnd()),
      writeErr: (text) => io.error(text.trimEnd()),
    });

  program
    .command("list")
    .description("List available scenarios")
    .action(() => {
      if (registeredScenarios.length === 0) {
        io.out("No scenarios available.");
        return;
      }
      for (const scenario of registeredScenarios) {
        io.out(`${scenario.id}\t${scenario.description}`);
      }
    });

  program
    .command("run")
    .description("Run all scenarios or one scenario")
    .argument("[scenario]", "scenario id")
    .requiredOption("--fixture <path>", "source fixture directory")
    .option("--evidence <path>", "save JSON evidence, including reproduction logs")
    .action(async (scenarioId: string | undefined, options: { fixture: string; evidence?: string }) => {
      const selected = scenarioId === undefined
        ? registeredScenarios
        : registeredScenarios.filter((scenario) => scenario.id === scenarioId);

      if (scenarioId !== undefined && selected.length === 0) {
        program.error(`Unknown scenario: ${scenarioId}`, {
          code: "cachetrust.unknownScenario",
          exitCode: 1,
        });
      }
      if (selected.length === 0) {
        io.out("No scenarios available.");
        return;
      }

      const results: ScenarioResult[] = [];
      for (const scenario of selected) {
        const result = await scenario.run({ fixturePath: options.fixture });
        results.push(result);
        io.out(`${result.status.toUpperCase()} ${result.scenarioId}: ${result.message}`);
      }
      if (options.evidence !== undefined) {
        await mkdir(dirname(options.evidence), { recursive: true });
        await writeFile(options.evidence, `${JSON.stringify({ results }, null, 2)}\n`);
      }
      process.exitCode = exitCodeFor(results);
    });

  program
    .command("verify")
    .description("Verify a local Turborepo project from a JSON configuration")
    .requiredOption("--config <path>", "verification configuration JSON")
    .action(async (options: { config: string }) => {
      const controller = new AbortController();
      let cancellationReported = false;
      const cancel = () => {
        cancellationReported = true;
        io.error("Cancellation requested; terminating active child processes.");
        controller.abort();
      };
      process.once("SIGINT", cancel);
      try {
        const loaded = await services.loadConfig(options.config);
        const config = loaded.config;
        io.out(`VERIFY target=${basename(config.projectRoot)} task=${config.turbo.task} mutation=${config.mutation.kind}`);
        const evidence = await services.verify(config, { signal: controller.signal });
        const cacheRun = evidence.runs.find((run) => run.id === "cache-v2");
        for (const task of config.tasks) {
          const observed = cacheRun?.tasks.find((entry) => entry.id === task.id)?.cache.status ?? "UNAVAILABLE";
          io.out(`CACHE ${task.id} expected=${task.expectedAfterMutation} observed=${observed}`);
        }
        const baseline = evidence.comparisons?.baselineStable;
        io.out(`BASELINE stable=${baseline === undefined ? "unavailable" : String(baseline)}`);
        io.out(`VERDICT ${evidence.verdict.status}: ${evidence.verdict.reasonCodes.join(", ")}`);
        const evidenceRelative = relative(process.cwd(), config.evidenceFile);
        io.out(`EVIDENCE ${evidenceRelative.startsWith("..") ? basename(config.evidenceFile) : evidenceRelative}`);
        process.exitCode = exitCodeForVerification(evidence.verdict.status);
      } catch (error) {
        const malformed = error instanceof ConfigError
          || (error instanceof ConfigFileError && error.reasonCode === "MALFORMED_JSON");
        const status: VerificationStatus = malformed ? "INCONCLUSIVE" : "ENVIRONMENT_ERROR";
        const errorCode = typeof error === "object" && error !== null && "code" in error
          ? (error as { code?: unknown }).code
          : undefined;
        const reason = error instanceof ConfigError || error instanceof ConfigFileError
          ? error.reasonCode
          : cancellationReported ? "CANCELLED"
            : errorCode === "EEXIST" ? "EVIDENCE_DESTINATION_EXISTS" : "CLI_FAILURE";
        const message = error instanceof ConfigError || error instanceof ConfigFileError
          ? error.message
          : cancellationReported ? "Verification was cancelled."
            : errorCode === "EEXIST" ? "Evidence destination already exists."
              : "Verification failed before evidence could be saved.";
        io.error(`${status} ${reason}: ${message}`);
        process.exitCode = exitCodeForVerification(status);
      } finally {
        process.removeListener("SIGINT", cancel);
      }
    });

  return program;
}

export async function main(argv: readonly string[] = process.argv): Promise<void> {
  await createCli().parseAsync(argv);
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error: unknown) => {
    if (!(error instanceof CommanderError)) console.error(error);
    process.exitCode = 1;
  });
}
