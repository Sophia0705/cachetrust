# AGENTS.md — CacheTrust

## 1. Project Identity

CacheTrust is a CLI for detecting incorrect reuse of cached build outputs in Turborepo-based projects.

Its purpose is to compare actual cache behavior against independently generated clean-build baselines, using task-level cache evidence, output fingerprints, and reproducible reports.

CacheTrust is not a general-purpose build orchestrator.

Core principles:

- Prefer correctness and reproducibility over apparent success.
- Never claim a cache hit or miss without supporting evidence.
- Never classify a deliberately misconfigured fixture as an upstream Turborepo bug.
- Preserve raw observations before applying any normalization.
- Treat missing or ambiguous evidence as uncertainty, not success.
- Keep verification independent of the system being evaluated.

## 2. Repository and Context Verification

Before beginning a substantial task:

1. Identify the current working directory and Git repository root.
2. Check the current branch, HEAD, and working-tree status.
3. Read the relevant phase documentation and existing implementation.
4. Check whether the requested work has already been completed or partially implemented.
5. Identify pre-existing uncommitted and untracked files.

Do not infer project progress from HEAD alone. Relevant work may be uncommitted.

If the repository, branch, or required artifacts do not match the requested task, stop and report the discrepancy.

Do not silently switch repositories, branches, or worktrees.

## 3. Scope Discipline

Follow the explicitly requested phase and task.

- Do not resume unrelated work from previous sessions.
- Do not repair unrelated failures.
- Do not implement future phases without authorization.
- Do not expand a documentation task into production code changes.
- Do not expand a focused implementation task into a repository-wide refactor.
- Do not modify unrelated files merely because an improvement is possible.

If a prerequisite is missing, determine whether it is within the authorized scope.

If not, report the blocker and stop.

An earlier instruction from a previous session must not override the current task.

## 4. Protected Areas

The following areas require explicit task-specific authorization before modification:

- `src/process.ts`
- Windows process termination and timeout handling
- `taskkill` invocation and fallback logic
- CacheTrust exit-code semantics
- Cache correctness classification rules
- Baseline independence and workspace isolation
- Existing evidence and verification contracts

Do not modify these areas as incidental fixes.

In particular, never resume historical Phase 2 process-termination work during Phase 3 verification tasks.

Reading protected code for analysis is allowed.

If a protected change is genuinely necessary, explain why and stop before making it unless the current task explicitly authorizes it.

## 5. Git and Change Preservation

Preserve all existing user work.

Never run destructive Git operations without explicit authorization, including:

- `git reset --hard`
- `git clean`
- destructive checkout or restore
- discarding uncommitted changes
- overwriting existing evidence
- force-pushing

Do not commit, push, rebase, or merge unless explicitly requested.

Before editing a file, check whether it already contains unrelated changes.

Do not overwrite another task's work.

At completion, distinguish pre-existing changes from changes made during the current task.

## 6. Execution and Resource Safety

Treat dependency installation, builds, large test suites, and external repository operations as potentially expensive.

Before a substantial execution:

1. Identify the exact command and target.
2. Verify the package manager and executable version.
3. Check resource requirements when relevant.
4. Confirm workspace and cache isolation.
5. Define expected outputs and stop conditions.
6. Respect any task-specific execution budget.

Do not automatically retry failed installs or builds.

A retry requires explicit authorization unless the current task already defines a bounded retry policy.

Never silently switch package managers or versions.

Do not run destructive cleanup against paths that have not been independently verified as owned temporary workspaces.

Avoid concurrent resource-intensive jobs unless explicitly authorized.

## 7. Cache Verification Integrity

For real-world verification:

- Use the pinned repository commit and toolchain versions.
- Preserve the original target repository and lockfile.
- Use independently prepared clean baselines.
- Verify actual Turbo task execution and cache behavior.
- Distinguish expected HIT/MISS from observed HIT/MISS.
- Record raw output fingerprints.
- Apply normalization only when narrowly justified and documented.
- Never normalize away functional output differences.
- Check output coverage against the actual task configuration.
- Treat incomplete output coverage as a verification limitation.
- Never infer successful execution solely from process exit code zero.

Do not use an existing cache as proof that a clean baseline was executed.

Do not classify a task as a verified HIT or MISS based solely on expectation.

## 8. Verdict and Evidence Rules

Use the existing CacheTrust verdict and exit-code contracts.

Do not silently redefine PASS, MISMATCH, STALE_HIT, UNSAFE_SAVE, INCONCLUSIVE, or ENVIRONMENT_ERROR.

Distinguish:

- Verified facts
- Static inferences
- Runtime observations
- Unverified assumptions
- Known limitations

A command that fails before executing build tasks is not evidence of build-output correctness or incorrectness.

If prerequisites are unmet, report the appropriate blocked or inconclusive state instead of manufacturing a PASS.

Preserve evidence needed to reproduce conclusions, including:

- Target commit and tool versions
- Relevant commands and configuration
- Actual task execution and cache observations
- Output inventory and fingerprints
- Baseline comparisons
- Failure stage and error information
- Known evidence gaps

Do not overwrite prior run evidence. Use separate run identifiers or evidence directories.

Do not expose secrets, credentials, private environment values, or unnecessary personal paths in evidence or logs.

## 9. Test and Validation Policy

Use the smallest meaningful validation scope first.

For code changes:

1. Add or update focused tests.
2. Run relevant tests.
3. Run typecheck, lint, or build when appropriate and authorized.
4. Run `git diff --check`.
5. Review the final changed-file list.

Do not claim that unexecuted tests passed.

Do not silently fix unrelated failures.

If validation cannot complete, report precisely what ran, what failed, and what remains unverified.

Documentation-only tasks should not trigger dependency installation or large builds unless specifically authorized.

## 10. Phase Documentation

Use the existing `docs/` and `evidence/` conventions.

Before starting a phase, read its relevant design, previous results, and unresolved conditions.

Each substantial phase report should record:

- Objective and scope
- Starting state
- Relevant pinned versions
- Work performed
- Observations and evidence
- Validation performed
- Deviations and limitations
- GO / CONDITIONAL GO / NO-GO decision, where applicable
- Remaining blockers
- Recommended next step

A phase being documented does not automatically mean it is ready for the next phase.

A NO-GO decision must remain in effect until its explicit blocking conditions are satisfied.

## 11. Failure Handling

When a command fails:

1. Identify the exact failure stage.
2. Distinguish CLI validation, environment setup, task execution, and verification failures.
3. Preserve the original failure evidence.
4. Do not retry automatically.
5. Do not broaden the task into unrelated repairs.
6. Report the smallest plausible corrective action.

Do not change multiple independent variables during a controlled retry unless explicitly authorized.

Do not misrepresent a failed preflight as an executed build failure.

## 12. Completion Report

At the end of each task, report:

1. What was completed
2. What was not completed
3. Files created or modified
4. Commands and tests executed
5. Evidence and results
6. Remaining risks or blockers
7. Whether the next step is authorized or requires approval

Use explicit statements for skipped validation.

Do not start the next phase automatically.

Do not commit or push unless explicitly authorized.

## 13. Instruction Precedence

Follow system and developer instructions, then the current user's explicit task instructions, then this repository guidance.

Task-specific authorization may permit an otherwise protected operation, but only within the stated scope.

When instructions conflict or authorization is ambiguous, choose the non-destructive action and ask for clarification.

These rules guide agent behavior; they are not a technical enforcement mechanism. Verify actual commands, changes, and evidence rather than assuming compliance.