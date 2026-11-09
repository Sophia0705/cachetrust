# Phase 3 Step D-2 — Core verification engine

Implementation date: 2026-11-09 (Asia/Seoul)

## Scope and result

Step D-2 implements the reusable verification core described in D-1 after the Windows isolation
preflight returned GO. It does not add a public CLI command or run the real Basic C1–C4 suite.

The engine accepts a typed configuration, rejects dirty repositories, creates three independently
installed workspaces, populates one dedicated local cache, applies a no-op or deterministic file
replacement, runs a cache-enabled build and two clean baselines, compares outputs, evaluates
task-level cache evidence, and writes schema-v1 JSON evidence.

## Adopted policies

### Output coverage fails closed

Every selected task has explicit include/exclude patterns. The engine compares them with the
task-relative `outputs` and `excludedOutputs` reported by every Turbo summary. Only literal paths
and `directory/**` are accepted. A discrepancy produces
`INCONCLUSIVE/OUTPUT_COVERAGE_MISMATCH`; it cannot produce PASS.

### Windows dependency isolation

The implementation follows `phase3-step-d2-windows-preflight.md`:

1. Run `git status --porcelain=v1 --untracked-files=all` before expensive setup.
2. Reject dirty targets and unsupported project links without resetting anything.
3. Copy source without `.git`, `node_modules`, `.turbo`, or configured output roots.
4. Run the configured frozen install separately and sequentially in `cache`, `baseline-a`, and
   `baseline-b`.
5. Verify lockfile SHA-256 values did not change.
6. Reject installed dependency junctions/symlinks whose real target escapes their workspace.
7. Give every workspace a distinct cache; only v1 and cache-v2 share the cache workspace's cache.
8. Validate cleanup ownership and rely on the existing Windows process-tree timeout handling.

The package manager is configured with an explicit name/version and a command whose arguments must
include `--frozen-lockfile` or `--immutable`. D-2 records the declared package-manager version; D-3
should add a preflight version command before exposing this contract publicly.

### Narrow normalization only

Raw manifests are always retained. The MVP accepts only exact file omissions and exact literal
replacement in one exact file. It exposes no regex or glob-based rewriting. Each transformation
has a reason, and evidence stores the search value's SHA-256 rather than the value itself.

A rule that overlaps a configured functional signal is rejected. If normalization makes outputs
equal while the raw outputs differ and functional checks independently prove a difference, the
result is `INCONCLUSIVE/NORMALIZATION_UNSAFE`, never PASS.

### Dirty repositories rejected

Tracked, staged, and untracked changes all reject verification with
`INCONCLUSIVE/DIRTY_REPOSITORY` before workspace creation or dependency installation. There is no
permissive mode in D-2.

## Modules

| Module | Responsibility |
| --- | --- |
| `verification/config.ts` | Runtime validation, minimal types, safe relative paths |
| `verification/isolation.ts` | Clean-Git check, copies, frozen installs, link/lockfile checks, cleanup |
| `verification/mutation.ts` | No-op/replacement mutation, hash preconditions, verification/restoration |
| `verification/turbo-runner.ts` | Multi-task Turbo execution, summary parsing, output coverage |
| `verification/outputs.ts` | Cleanup, raw SHA-256 manifests, narrow normalization, functional checks |
| `verification/verdict.ts` | Pure verdict rules and reason codes |
| `verification/evidence.ts` | Portable schema-v1 evidence, log digests, redaction, atomic write |
| `verification/engine.ts` | Ordered lifecycle orchestration and partial failure evidence |

The modules are exported through `src/index.ts`. Existing Phase 2 `runTurbo`, scenarios, fixtures,
CLI commands, statuses, and exit-code mappings are unchanged.

## Lifecycle implemented

1. Validate configuration and path boundaries.
2. Reject dirty Git state.
3. Inspect project links, copy three workspaces, independently install, and verify lockfiles/links.
4. Clean declared outputs and populate the cache with v1.
5. Require a successful Turbo summary and exact output coverage.
6. Apply and verify the mutation in the cache workspace.
7. Remove outputs, run cache-v2 with the v1 cache, and capture task/cache/output evidence.
8. Apply the same mutation in each baseline; run sequentially with distinct empty caches.
9. Require both baseline task observations to be genuine MISS/non-local/non-remote.
10. Compare raw manifests, optional normalized manifests, and functional checks.
11. Evaluate verdict and reason codes.
12. Restore mutations, verify the original input remains unchanged, atomically write evidence, and
    remove only the owned temporary root.

An optional `AbortSignal` propagates through Git checks, dependency installation, and Turbo runs.
Cancellation uses the same Windows process-tree termination path as timeouts and cleanup retries
transient Windows file locks before returning `ENVIRONMENT_ERROR/CANCELLED` evidence.

No run uses `--force` as isolation proof. Remote cache variables are cleared for Turbo child
processes, and a reported remote HIT cannot satisfy the local-HIT contract.

## Verdict model

| Status | Minimum meaning | Exit code reserved for D-3 |
| --- | --- | ---: |
| `PASS` | Expected HIT/MISS proven and output equals stable baselines | 0 |
| `MISMATCH` | Reused local hash/HIT plus stable, functionally confirmed stale output | 1 |
| `INCONCLUSIVE` | Missing proof, unstable baseline, unsafe normalization, or ambiguous coverage | 2 |
| `ENVIRONMENT_ERROR` | Install/build/summary/isolation/mutation execution failure | 3 |

Important reason codes include `CORRECT_REUSE`, `CORRECT_INVALIDATION`,
`CONFIRMED_STALE_REUSE`, `LOCAL_HIT_UNPROVEN`, `NONDETERMINISTIC_BASELINE`,
`MUTATION_EFFECT_UNPROVEN`, `OUTPUT_COVERAGE_MISMATCH`, `NORMALIZATION_UNSAFE`,
`DIRTY_REPOSITORY`, `UNSAFE_DEPENDENCY_LINK`, `BUILD_FAILED`, and `SUMMARY_INVALID`.

The core does not change `src/cli.ts`; D-3 will integrate the new four statuses while preserving
the existing Phase 2 mapping of STALE_HIT/UNSAFE_SAVE to exit 1.

## Evidence policy

Evidence uses `cachetrust.verification/1` and contains:

- CacheTrust/schema versions, timestamps, sanitized target label and commit;
- OS, architecture, Node, configured package manager, and observed Turbo summary version;
- selected tasks, output contract, mutation type, and sanitized normalization policy;
- logical workspace/cache identities and lockfile hashes;
- install/build command arrays, exit/timeout/duration, task hashes, and cache observations;
- raw and optional normalized per-file SHA-256 manifests;
- baseline stability, functional checks, verdict, reason codes, and limitations.

Absolute workspace roots and environment-variable values are not written. Token-like command
arguments are redacted. Raw stdout/stderr content is not retained by default because build logs can
contain secrets; evidence stores byte counts and SHA-256 digests. D-3 may add an explicit opt-in raw
log retention policy.

## Tests

The focused suite covers:

- minimal config, frozen install, traversal, output patterns, and normalization restrictions;
- no-op/replacement mutation, precondition failure, restoration, raw manifests, and functional
  presence/absence checks;
- Turbo HIT/MISS parsing, missing selected tasks, and output mismatch;
- PASS for reuse/invalidation, missing HIT, confirmed MISMATCH, nondeterminism, output ambiguity,
  and unsafe normalization;
- dirty-repository rejection, three independent installs, source preservation, cache separation,
  owned cleanup, escaping link-target rejection, and cancelled-install cleanup;
- evidence redaction, versioning, and atomic write;
- a full fake-Turbo lifecycle that reuses a constant hash/local HIT, restores stale v1 output, and
  is classified MISMATCH against two stable v2 baselines;
- all existing Phase 1/2 tests and Windows process-tree termination.

Routine tests use only lightweight disposable fixtures. No Basic, shadcn/ui, or Astro build was
run.

## Known limitations and D-3 boundary

- CacheTrust does not sandbox dependency lifecycle scripts; targets and locked dependencies must be
  trusted.
- The configured package-manager version is not independently executed with `--version` yet.
- Evidence files must be written to a new destination; overwrite/rotation policy belongs in D-3.
- Source repositories containing legitimate symlinks are rejected in the MVP rather than copied
  with unproven semantics.
- Exact literal normalization cannot cover every framework's nondeterminism. Unsupported cases are
  intentionally INCONCLUSIVE.
- The engine is programmatic only. Config-file parsing, public `verify`, progress display,
  interruption UX, and exit-code wiring are D-3.
- Real Basic C1–C4 policy/configuration and regression evidence are D-4.
