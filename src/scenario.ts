export type ScenarioStatus = "passed" | "failed" | "inconclusive";

export interface ScenarioContext {
  fixturePath: string;
}

export interface ScenarioResult {
  scenarioId: string;
  status: ScenarioStatus;
  message: string;
}

export interface Scenario {
  id: string;
  description: string;
  run(context: ScenarioContext): Promise<ScenarioResult>;
}

// Phase 2 registers the two Turbo scenarios here.
export const scenarios: readonly Scenario[] = [];
