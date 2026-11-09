# Phase 3 Step D-4 — Real Turborepo Basic C1–C4 regression

Execution date: 2026-11-09 (Asia/Seoul)

## Scope and provenance

- Upstream: `vercel/turborepo`
- Commit: `17691acd9bc80171e5ef4b3532ff0748ba231813`
- Scope: complete `examples/basic` monorepo
- Node: 24.19.0
- pnpm: 11.25.0 from the existing Corepack-managed cache
- Turbo: 2.10.12
- OS: Windows, 16 GB RAM host
- Lockfile SHA-256: `ff8cfdf35e2cc167a1df052479441b736776b765cc931c2d69b4e23ab6b66c0e`

The preparation script verifies the clean pinned upstream checkout, enumerates only Git-tracked
Basic files, and creates one disposable standalone Git snapshot per case. These local snapshot
commits make the engine's clean-repository gate meaningful but are not represented as upstream
commits; `preparation.json` records the upstream provenance. C4 commits its faulty `turbo.json` in
its own disposable snapshot before v1. No upstream file, original fixture, lockfile, global package
manager setting, or existing evidence was modified.

Every public CLI invocation used three independently copied workspaces, three frozen offline
installs, one shared cache only for v1/cache-v2, distinct empty baseline caches, remote cache
disabled, a five-minute install/build timeout, and Turbo concurrency 2. Cases ran sequentially.

## Normalization policy

Raw manifests are always retained. Semantic comparison omits only `.next/trace` and
`.next/trace-build` for each app. It derives and exactly replaces each app's BUILD_ID,
server-action encryption key, three preview-mode values, and the isolated absolute project root.
BUILD_ID is also replaced in output paths. Project-root replacement is confined to the matching
app's `.next` tree and explicitly handles its JSON-string encoding.

The project-root rule was required because independent engine workspaces caused exactly four
remaining differences: `required-server-files.js` and `.json` for docs and web. No mutation marker,
source content, task hash, or other output was normalized or excluded. A deterministic unit test
covers dynamic text/JSON extraction, path replacement, and JSON-string encoding.

## Results

| Case | Verdict / exit | docs cache-v2 | web cache-v2 | Normalized comparison |
| --- | --- | --- | --- | --- |
| C1 same input | PASS / 0 | HIT, `6d81d2f140cad23b` | HIT, `41ae4b5e2f67928e` | cache = baseline A = baseline B |
| C2 app source | PASS / 0 | HIT, `6d81d2f140cad23b` | MISS, `047451cd3f8fffec` | cache = both baselines |
| C3 shared UI | PASS / 0 | MISS, `b3552379525545f4` | MISS, `bd459ef9d5aca530` | cache = both baselines |
| C4 input omission | MISMATCH / 1 | HIT, `4f5b83823a362943` | HIT, `81becf9272865116` | cache differs from stable baselines |

All v1 and baseline task observations were genuine MISS/non-local/non-remote. All C1 and C4
cache-v2 HITs were local, non-remote, and reused their v1 task hashes.

### C1 — same input

Both tasks restored from the local cache. The two independent clean baselines were stable and the
cache output matched them after the audited normalization. Verdict: `PASS/CORRECT_REUSE`.

### C2 — app source change

Only `apps/web/app/page.tsx` changed. docs reused its v1 hash with a local HIT; web changed from
`41ae4b5e2f67928e` to `047451cd3f8fffec` and missed. The exact C2 marker appeared in seven files in
the cache-v2 output and each baseline. Verdict: `PASS/CORRECT_REUSE,CORRECT_INVALIDATION`.

### C3 — shared UI change

The used `@repo/ui` button source changed. Although that package has no build task, both consuming
apps changed hashes and missed. The fixed `CACHE_TRUST_C3_V2` marker appeared in four files under
each app in cache-v2 and both baselines. Verdict: `PASS/CORRECT_INVALIDATION`.

### C4 — intentional input omission

The prepared fault added `!app/page.tsx` before v1. After changing the web page, both tasks produced
genuine local HITs with their original hashes. The cache-restored web output did not contain the C4
v2 marker, while both stable clean v2 baselines contained it in seven files. Normalized cache hash
`4966cef423e1d8670618f6a43610a893022571a0d3d79424262c987e3d217204` differed from baseline hash
`fa2cd870873913ac26533925ec7cb218bd1c5532d80b986f5aef0c88e8420262`.

Verdict: `MISMATCH/CONFIRMED_STALE_REUSE`. This is successful CacheTrust detection of an
intentionally incorrect configuration, not a Turborepo defect.

## Duration and Windows observations

| Case | Frozen installs total | Four build runs total | End-to-end wall interval |
| --- | ---: | ---: | ---: |
| C1 | 45.3 s | 58.0 s | about 112 s |
| C2 | 44.4 s | 66.4 s | about 119 s |
| C3 | 46.2 s | 66.6 s | about 122 s |
| C4 | 46.0 s | 55.7 s | about 112 s |

The public evidence schema does not sample peak memory, so Step D-4 does not claim a measured peak.
No final run timed out or reported out-of-memory. Initial free disk space was about 167 GiB.

Two Windows harness issues were resolved before final evidence:

1. A long experiment root made the nested native Turbo executable exceed a usable Windows path and
   fail with `spawn ... turbo.exe ENOENT`; final runs used a short disposable root.
2. pnpm's `verifyDepsBeforeRun` attempted redundant concurrent reinstalls when Turbo launched docs
   and web, producing `EEXIST`. Since each workspace had already completed a frozen install, the
   task environment set `PNPM_CONFIG_VERIFY_DEPS_BEFORE_RUN=false`. The lockfile and installed
   dependency graph were unchanged.

Earlier diagnostic and inconclusive attempts were not promoted as final results: sandbox symlink
EPERM, long-path ENOENT, the pnpm reinstall race, C1 before isolated-path normalization, and an
overly specific C3 marker check. Their causes were distinguished before rerunning fresh targets.

## Reproduction and evidence

Portable preparation and the base configuration live under `examples/phase3-basic`. The script
requires an already available Corepack pnpm 11.25.0 and refuses to download or overwrite a runtime
directory. Generated C1–C4 configs contain no credentials and final repository evidence contains no
personal absolute paths except sanitized command metadata already recorded by the schema where the
Corepack entry point was used.

`evidence/phase3-step-d4` contains final C1–C4 schema-v1 JSON, upstream preparation metadata, the
scenario diffs, and a concise run summary. The JSON files retain raw/normalized manifests, install
and run durations, task hashes, local/remote flags, functional matches, and output-log digests.
Raw stdout/stderr are not retained by design.

## Readiness

Step D-4 acceptance conditions are met: C1–C3 PASS with exits 0, C4 MISMATCH with exit 1, stable
independent baselines, real local HIT proof where required, raw evidence retention, and functional
marker proof. Step E can proceed, but was not started.
