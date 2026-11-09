# Phase 3 Step D-3 — Public `verify` CLI integration

Implementation date: 2026-11-09 (Asia/Seoul)

## Command

```text
cachetrust verify --config <path>
```

The path identifies a UTF-8 JSON file. Relative project, evidence, replacement-file, and explicit
executable paths are resolved from the configuration file's directory, not from an incidental
process working directory. JavaScript and TypeScript configuration files are not executed.

The command prints the target label, Turbo task, mutation kind, per-task expected/observed cache
state, baseline stability, final verdict/reason codes, and a portable evidence location. Normal
results use stdout; malformed/unreadable configuration and unexpected CLI failures use stderr.
Environment values, credentials, and unnecessary absolute workspace paths are not printed.

## Configuration contract

The public schema is version `"1"` and is implemented by D-2's
`validateVerificationConfig()`. Unknown fields are rejected rather than silently ignored.

Required top-level fields:

| Field | Meaning |
| --- | --- |
| `schemaVersion` | Must be `"1"` |
| `id` | Stable case identifier |
| `projectRoot` | Clean local Git project copied as verification input |
| `evidenceFile` | New JSON path outside `projectRoot` |
| `install` | Exact package-manager invocation, expected version, lockfiles, and timeout |
| `turbo` | Turbo invocation, task/filter selection, expected version, timeout/concurrency |
| `tasks` | Selected task IDs and expected post-mutation HIT/MISS |
| `outputs` | Complete per-task include/exclude contract |
| `mutation` | `none` or deterministic `replace-file` with before/after SHA-256 |

Optional fields are D-2 functional checks, exact-file/literal normalization, and the explicit
intentional-input-exclusion marker. Regex normalization, arbitrary mutation scripts, remote cache,
and permissive dirty-repository modes remain unsupported.

`install` contains:

```json
{
  "command": "node",
  "commandArgs": ["path/to/pinned/pnpm.mjs"],
  "versionArgs": ["--version"],
  "args": ["install", "--frozen-lockfile"],
  "packageManager": "pnpm",
  "packageManagerVersion": "11.25.0",
  "lockfiles": ["pnpm-lock.yaml"],
  "timeoutMs": 120000
}
```

`commandArgs` is the common prefix used by both the version probe and installation. This guarantees
that a Node/Corepack entry point checked with `--version` is the same entry point used for install.
The complete install invocation must contain `--frozen-lockfile` or `--immutable`.

A runnable lightweight example is [examples/cachetrust.config.json](../examples/cachetrust.config.json).
It exercises correct same-input local reuse using [fixtures/verify-cli](../fixtures/verify-cli).
Run it only from a clean checkout, then remove the generated `examples/verify-evidence.json` before
another run. It is a harness example, not a real-world Basic C1–C4 claim.

## Package-manager enforcement

Before creating or installing any workspace, CacheTrust:

1. checks that the target Git repository is clean;
2. reconciles `package.json#packageManager`, when present, with the configured name/version;
3. resolves the actual executable from an explicit path or `PATH`;
4. runs the configured common prefix plus `versionArgs`;
5. requires exact expected/observed version equality;
6. derives the install command from the same resolved executable and common prefix.

Windows `.cmd` and `.bat` executables are launched through one `cmd.exe /d /c call` adapter for
both probe and install. Corepack is not allowed to download or silently substitute a version.
Missing executables, failed probes, declaration mismatches, and version mismatches fail before
dependency installation. Evidence records the expected version, observed version when available,
executable basename, probe exit/timeout/duration, and stdout/stderr digests.

## Verdicts and exit codes

The CLI does not recompute D-2 verdicts.

| Verdict | Exit code |
| --- | ---: |
| `PASS` | 0 |
| `MISMATCH` | 1 |
| `INCONCLUSIVE` | 2 |
| `ENVIRONMENT_ERROR` | 3 |

Existing Phase 2 `STALE_HIT` and `UNSAFE_SAVE` remain exit 1. Invalid, unsupported, malformed, or
unsafe configuration is INCONCLUSIVE. An unreadable config, missing executable, version mismatch,
build/install failure, cancellation, or evidence-write failure is ENVIRONMENT_ERROR.

## Evidence behavior

The command uses `cachetrust.verification/1` directly. Evidence preserves task hashes and cache
observations, raw/normalized manifests, two-baseline consistency, functional checks, install/build
metadata, reason codes, and limitations. Package-manager expected/observed versions are included.

Evidence publishing uses a completed sibling temporary file and an exclusive final copy. An
existing destination is never overwritten. Temporary files are removed on success or failure, and
the CLI prints `EVIDENCE` only after the engine has completed the write. Raw logs remain digest-only
by default because build output may contain secrets.

## Cancellation and Windows cleanup

The command installs a temporary SIGINT handler and passes one `AbortSignal` through Git checks,
the version probe, frozen installs, and Turbo runs. D-2's process runner terminates the active
Windows process tree with `taskkill /T /F`; the isolation owner then removes only its validated
temporary root with Windows lock retries. Cancellation cannot yield PASS and maps to
`ENVIRONMENT_ERROR/CANCELLED`.

## Safety limitations

- The target repository must be clean; CacheTrust never resets, stashes, or cleans it.
- Mutable original `node_modules` links are not reused.
- Configured and Turbo-discovered outputs must agree exactly.
- Normalization is exact and auditable and cannot overlap a functional mutation signal.
- Dependency lifecycle scripts run with the user's permissions. Independent installation is not a
  security sandbox; the project and locked dependencies must be trusted.
- The evidence path must be outside the target and must not already exist.
- Legitimate project symlinks remain unsupported in the MVP.

## Validation and D-4 boundary

Tests cover help/config diagnostics, all four exit codes, package-manager acceptance/mismatch/
missing executable/Windows `.cmd`, executable consistency, evidence no-overwrite behavior, SIGINT,
Windows process-tree termination, dirty-repository rejection, isolated cleanup, and the existing
Phase 1/2 commands.

D-4 may now supply Basic-specific C1–C4 configurations, audited Next.js normalization data, and
slow regression orchestration. D-3 does not run or claim those real-world regressions, shadcn/ui,
or Astro.
