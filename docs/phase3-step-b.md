# Phase 3 Step B — Turborepo Basic baseline and determinism

Experiment date: 2026-11-08 (Asia/Seoul)

## Scope and environment

- Upstream: `vercel/turborepo`
- Revision: `17691acd9bc80171e5ef4b3532ff0748ba231813`
- Scope: complete `examples/basic` workspace
- Node.js: `24.19.0`
- pnpm: `11.25.0`, invoked from Corepack's versioned cache
- Turbo: `2.10.12`
- OS: Windows, 16 GB RAM
- CacheTrust branch: `codex/phase-3-real-world-verification`

The upstream repository was sparse-checked out in a directory outside the CacheTrust repository.
The checkout remained clean. No upstream file, lockfile, or global package-manager setting was
changed.

## Installation

The command used the exact Corepack pnpm version with `--frozen-lockfile`. Installation succeeded
in 52.8 seconds. The lockfile SHA-256 was identical before and after installation:

```text
ff8cfdf35e2cc167a1df052479441b736776b765cc931c2d69b4e23ab6b66c0e
```

Turbo starts package scripts through `pnpm` from `PATH`. The first measured attempt therefore found
the user's global pnpm 11.20.0 and correctly stopped on the version mismatch. This was resolved
without changing the global installation: an experiment-local `pnpm.cmd` shim invokes Corepack's
cached pnpm 11.25.0 entry point, and that directory is prepended only to the measured process PATH.
The failed attempt is retained in the evidence logs.

The installed Turbo 2.10.12 package did not contain the `docs/` directory referenced by the
upstream `AGENTS.md`. No Turbo configuration was changed; the experiment used the checked-in
`turbo.json` and explicit local-cache CLI flags.

## Isolation method

All runs used:

- `TURBO_TOKEN`, `TURBO_TEAM`, and `TURBO_REMOTE_ONLY` cleared;
- `CI=1` and `NEXT_TELEMETRY_DISABLED=1` fixed;
- `--cache=local:rw`, an explicit cache directory, `--summarize`, `--ui=stream`, and `--no-color`;
- concurrency limited to 2;
- both `apps/web/.next` and `apps/docs/.next` removed before every run after the first.

The cached run reused the initial run's cache directory. Each independent run used a new,
previously nonexistent cache directory (`baseline-1`, `baseline-2`, or `baseline-3`). Because the
declared output directories were also absent, independent runs could not reuse either cached
artifacts or pre-existing output. `--force` was not used.

## Build and cache results

The memory value is the highest observed sum of working sets for Node processes started by the
measurement wrapper. It is a practical observation, not a platform-level peak-RSS guarantee.

| Run | Result | Turbo cache | Wrapper time | Observed peak Node working set |
| --- | --- | --- | ---: | ---: |
| Initial | success | docs MISS, web MISS | 27.159 s | 2.654 GiB |
| Cached restore | success | docs local HIT, web local HIT | 2.459 s | 0.168 GiB |
| Baseline 1 | success | docs MISS, web MISS | 21.174 s | 2.610 GiB |
| Baseline 2 | success | docs MISS, web MISS | 20.479 s | 2.594 GiB |
| Baseline 3 | success | docs MISS, web MISS | 20.654 s | 2.685 GiB |

The initial Turbo task phase took 17.454 seconds. The cached Turbo task phase took 1.147 seconds and
reported `FULL TURBO`.

All summaries reported the same input hashes:

| Task | Hash |
| --- | --- |
| `docs#build` | `5efde0342e983072` |
| `web#build` | `c30eb01a395cb7f6` |

The cached run explicitly reported `cache.status = HIT` and `cache.local = true` for both tasks.
Each independent run reported `MISS` and `local = false`.

## Raw fingerprints

The raw manifest hashes every Turbo-declared output under `.next/**` except `.next/cache/**` and
`.next/dev/**`, which are exclusions already present in the upstream `turbo.json`.

| Output | Files | Bytes | Manifest SHA-256 |
| --- | ---: | ---: | --- |
| Initial | 310 | 11,351,136 | `c42723e008352ac8ed1f12298ee5c6c8b0bd0bbfb15aa7ea0a1025a601350bcb` |
| Cached restore | 310 | 11,351,136 | `c42723e008352ac8ed1f12298ee5c6c8b0bd0bbfb15aa7ea0a1025a601350bcb` |
| Baseline 1 | 310 | 11,351,126 | `9d7bc2e2e9ea6b418538b9aa2771d27e5d3f357399a2ed72261c8405fb188aac` |
| Baseline 2 | 310 | 11,351,149 | `d9f869f75e942e72f88730e989f0240c0c44a10761088ec9d7148cee9c679e37` |
| Baseline 3 | 310 | 11,351,124 | `2310556e8bf24c9271d8afd6ac7d0c9fb63767ddcbd040a8a5a9a39c9ec46fd1` |

The initial and cache-restored output manifests match exactly. Independent builds do not match each
other byte-for-byte, so the unmodified Basic output is not a deterministic raw reference.

## Nondeterministic output analysis

Comparing independent builds found 58 changed file contents and six build-ID-scoped paths per
comparison. The differences were traced to:

1. a random Next.js `BUILD_ID` for each application and paths/content containing it;
2. a random server-action encryption key in `server-reference-manifest.{json,js}`;
3. random preview-mode ID, signing key, and encryption key in `prerender-manifest.json`;
4. `.next/trace` and `.next/trace-build`, which contain timing and execution-path observations.

No files were removed from the raw manifests to make them match. For a separate semantic
comparison, the known random identifiers and keys were replaced with named placeholders, build-ID
path segments were normalized, and only the four diagnostic trace files (two per app) were omitted.
This rule produced 306 files and the same normalized manifest SHA-256 for the cached output and the
two retained independent output snapshots:

```text
700c5da5aca36d990e147f73a2de030f0d38e7d6990e2910579d7d5690b8c3b1
```

The trace exclusion is justified only for the semantic comparison because traces describe build
execution rather than deployable application behavior. The build ID and cryptographic keys were
normalized, not silently excluded; their raw differences remain in evidence.

## Verdict

- Initial build: **successful**.
- Same-input local cache reuse: **confirmed** for both tasks.
- Cached artifact restoration: **byte-identical to the initial artifact set**.
- Raw independent build determinism: **not achieved**, due to documented Next.js-generated random
  identifiers, cryptographic keys, and trace data.
- Semantic comparison after explicit normalization: **deterministic and matching** across cached
  and independent builds.
- Cache correctness verdict: **comparable only with the documented normalization policy**. The raw
  outputs alone cannot support PASS/MISMATCH classification.

## Windows cost and issues

- No build timeout or out-of-memory failure occurred.
- Peak observed Node working set stayed below 2.7 GiB for all full builds.
- Windows process execution itself was stable.
- Two setup-only failures were retained: measurement-wrapper quoting and child-task pnpm PATH
  selection. Both were isolated harness issues, not upstream build failures.

## Step C readiness

Step C can proceed for Basic, with one prerequisite: its comparison contract must preserve the raw
manifest while also applying the explicit Next.js normalization policy above. Error-injection runs
must never classify a mismatch solely from random build IDs, keys, or trace data. A reportable cache
mismatch still requires a real local HIT plus a difference in the normalized deployable output.

## Evidence

Evidence is stored under `evidence/phase3-step-b/`:

- install/version/lockfile logs;
- stdout, stderr, timing, and memory metrics for every run;
- Turbo summary JSON files containing hashes and cache status;
- raw per-file SHA-256 manifests;
- normalized manifests for the cached and retained independent snapshots;
- setup-failure logs documenting the two resolved Windows harness issues.
