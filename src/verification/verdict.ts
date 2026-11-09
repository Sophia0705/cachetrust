import type { ExpectedCacheStatus, VerificationStatus } from "./config.js";
import type { ObservedTurboTask } from "./turbo-runner.js";

export type VerdictReasonCode =
  | "CORRECT_REUSE"
  | "CORRECT_INVALIDATION"
  | "CONFIRMED_STALE_REUSE"
  | "LOCAL_HIT_UNPROVEN"
  | "INVALIDATION_CAUSE_UNPROVEN"
  | "UNEXPECTED_CACHE_STATE"
  | "NONDETERMINISTIC_BASELINE"
  | "MUTATION_EFFECT_UNPROVEN"
  | "OUTPUT_COVERAGE_MISMATCH"
  | "NORMALIZATION_UNSAFE"
  | "SUMMARY_INVALID";

export interface VerificationVerdict {
  status: VerificationStatus;
  reasonCodes: VerdictReasonCode[];
  implicatedTasks: string[];
  explanation: string;
}

export interface VerdictInput {
  expectedTasks: Array<{ id: string; expectedAfterMutation: ExpectedCacheStatus }>;
  v1Tasks: ObservedTurboTask[];
  cacheTasks: ObservedTurboTask[];
  baselineATasks: ObservedTurboTask[];
  baselineBTasks: ObservedTurboTask[];
  outputCoverageValid: boolean;
  baselinesStable: boolean;
  cacheMatchesBaseline: boolean;
  rawCacheMatchesBaseline: boolean;
  normalizationUsed: boolean;
  mutationEffectProven: boolean;
  functionalDifferenceConfirmed: boolean;
}

function task(tasks: readonly ObservedTurboTask[], id: string): ObservedTurboTask | undefined {
  return tasks.find((entry) => entry.id === id);
}

export function classifyVerification(input: VerdictInput): VerificationVerdict {
  if (!input.outputCoverageValid) {
    return {
      status: "INCONCLUSIVE", reasonCodes: ["OUTPUT_COVERAGE_MISMATCH"], implicatedTasks: [],
      explanation: "Configured outputs do not fully agree with Turbo-discovered outputs.",
    };
  }
  if (!input.baselinesStable) {
    return {
      status: "INCONCLUSIVE", reasonCodes: ["NONDETERMINISTIC_BASELINE"], implicatedTasks: [],
      explanation: "Two independent clean baselines disagree.",
    };
  }
  if (!input.mutationEffectProven) {
    return {
      status: "INCONCLUSIVE", reasonCodes: ["MUTATION_EFFECT_UNPROVEN"], implicatedTasks: [],
      explanation: "The mutation's required output effect was not demonstrated.",
    };
  }
  if (input.normalizationUsed && input.rawCacheMatchesBaseline === false
      && input.cacheMatchesBaseline && input.functionalDifferenceConfirmed) {
    return {
      status: "INCONCLUSIVE", reasonCodes: ["NORMALIZATION_UNSAFE"], implicatedTasks: [],
      explanation: "Normalization concealed a confirmed functional difference.",
    };
  }

  const incomplete = input.expectedTasks.some(({ id }) =>
    [input.v1Tasks, input.cacheTasks, input.baselineATasks, input.baselineBTasks]
      .some((tasks) => task(tasks, id) === undefined));
  if (incomplete) {
    return {
      status: "INCONCLUSIVE", reasonCodes: ["SUMMARY_INVALID"], implicatedTasks: [],
      explanation: "Required task observations are missing.",
    };
  }

  const staleTasks = input.expectedTasks.filter(({ id, expectedAfterMutation }) => {
    if (expectedAfterMutation !== "HIT") return false;
    const before = task(input.v1Tasks, id)!;
    const cached = task(input.cacheTasks, id)!;
    return cached.cache.status === "HIT" && cached.cache.local && !cached.cache.remote
      && cached.hash === before.hash;
  }).map(({ id }) => id);

  if (!input.cacheMatchesBaseline && input.functionalDifferenceConfirmed && staleTasks.length > 0) {
    return {
      status: "MISMATCH", reasonCodes: ["CONFIRMED_STALE_REUSE"], implicatedTasks: staleTasks,
      explanation: "A genuine local cache hit restored output that differs functionally from stable baselines.",
    };
  }

  const reasons: VerdictReasonCode[] = [];
  const implicated: string[] = [];
  for (const expected of input.expectedTasks) {
    const before = task(input.v1Tasks, expected.id)!;
    const cached = task(input.cacheTasks, expected.id)!;
    const baselineA = task(input.baselineATasks, expected.id)!;
    const baselineB = task(input.baselineBTasks, expected.id)!;
    if (baselineA.cache.status !== "MISS" || baselineA.cache.local || baselineA.cache.remote
        || baselineB.cache.status !== "MISS" || baselineB.cache.local || baselineB.cache.remote) {
      reasons.push("UNEXPECTED_CACHE_STATE");
      implicated.push(expected.id);
      continue;
    }
    if (expected.expectedAfterMutation === "HIT") {
      if (cached.cache.status !== "HIT" || !cached.cache.local || cached.cache.remote) {
        reasons.push("LOCAL_HIT_UNPROVEN");
        implicated.push(expected.id);
      } else if (cached.hash !== before.hash) {
        reasons.push("UNEXPECTED_CACHE_STATE");
        implicated.push(expected.id);
      } else {
        reasons.push("CORRECT_REUSE");
      }
    } else if (cached.cache.status !== "MISS" || cached.cache.local || cached.cache.remote) {
      reasons.push("UNEXPECTED_CACHE_STATE");
      implicated.push(expected.id);
    } else if (cached.hash === before.hash) {
      reasons.push("INVALIDATION_CAUSE_UNPROVEN");
      implicated.push(expected.id);
    } else {
      reasons.push("CORRECT_INVALIDATION");
    }
  }

  const failureReasons = new Set<VerdictReasonCode>([
    "LOCAL_HIT_UNPROVEN", "INVALIDATION_CAUSE_UNPROVEN", "UNEXPECTED_CACHE_STATE",
  ]);
  if (reasons.some((reason) => failureReasons.has(reason)) || !input.cacheMatchesBaseline) {
    return {
      status: "INCONCLUSIVE",
      reasonCodes: reasons,
      implicatedTasks: implicated,
      explanation: !input.cacheMatchesBaseline
        ? "Cache-enabled output differs from the stable baseline without sufficient stale-hit proof."
        : "One or more task cache expectations were not proven.",
    };
  }
  return {
    status: "PASS",
    reasonCodes: [...new Set(reasons)],
    implicatedTasks: [],
    explanation: "Task cache observations and output comparisons match the configured expectations.",
  };
}
