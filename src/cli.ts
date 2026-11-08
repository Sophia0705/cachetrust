#!/usr/bin/env node
import { Command, CommanderError } from "commander";
import { pathToFileURL } from "node:url";
import { scenarios, type Scenario } from "./scenario.js";

export interface CliIo {
  out(message: string): void;
  error(message: string): void;
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
    .action(async (scenarioId: string | undefined, options: { fixture: string }) => {
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

      let failed = false;
      for (const scenario of selected) {
        const result = await scenario.run({ fixturePath: options.fixture });
        io.out(`${result.status.toUpperCase()} ${result.scenarioId}: ${result.message}`);
        failed ||= result.status !== "passed";
      }
      if (failed) process.exitCode = 1;
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
