#!/usr/bin/env node
import { Command, CommanderError } from "commander";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { pathToFileURL } from "node:url";
import { scenarios, type Scenario, type ScenarioResult } from "./scenario.js";

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

const defaultIo: CliIo = {
  out: (message) => console.log(message),
  error: (message) => console.error(message),
};

export function createCli(
  registeredScenarios: readonly Scenario[] = scenarios,
  io: CliIo = defaultIo,
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
