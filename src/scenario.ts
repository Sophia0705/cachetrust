import { bracketPathScenario } from "./scenarios/bracket-path.js";
import { midBuildMutationScenario } from "./scenarios/mid-build-mutation.js";

export type ScenarioStatus =
  | "PASS"
  | "STALE_HIT"
  | "UNSAFE_SAVE"
  | "INCONCLUSIVE"
  | "ENVIRONMENT_ERROR";

export interface ScenarioContext {
  fixturePath: string;
  timeoutMs?: number;
}

export interface ScenarioResult {
  scenarioId: string;
  status: ScenarioStatus;
  message: string;
  evidence: unknown;
}

export interface Scenario {
  id: string;
  description: string;
  run(context: ScenarioContext): Promise<ScenarioResult>;
}

export const scenarios: readonly Scenario[] = [bracketPathScenario, midBuildMutationScenario];
