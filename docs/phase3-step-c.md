# Phase 3 Step C — Turborepo Basic change and missing-input experiments

Experiment date: 2026-11-08 (Asia/Seoul)

## Environment and isolation

- Upstream revision: `17691acd9bc80171e5ef4b3532ff0748ba231813`
- Scope: complete `examples/basic` workspace
- Node.js: `24.19.0`
- pnpm: `11.25.0`
- Turbo: `2.10.12`
- OS: Windows, 16 GB RAM

Three disposable copies were created outside the CacheTrust repository for C2, C3, and C4. Each
copy used an offline frozen-lockfile install from the already verified pnpm store. The pristine Step
B checkout, CacheTrust fixtures, and tracked upstream files were not modified.

Every experiment used a dedicated v1 cache and a different, initially absent cache directory for
the v2 independent baseline. Both `.next` output trees were removed before each build after v1.
Remote caching was disabled, environment values were fixed as in Step B, and concurrency stayed at
2. `--force` was not used.

The Step B comparison policy was retained:

- preserve raw fingerprints for `.next/**`, excluding only upstream-declared `.next/cache/**` and
  `.next/dev/**`;
- normalize random Next.js build IDs, server-action encryption keys, and preview-mode keys;
- omit only `.next/trace` and `.next/trace-build` from the semantic fingerprint;
- never normalize experiment marker text or other application content.

## Result summary

| Case | Change | Cache observation | Independent comparison | Verdict |
| --- | --- | --- | --- | --- |
| C1 | none | docs/web local HIT | Step B normalized output matched | **PASS** |
| C2 | `apps/web/app/page.tsx` | web MISS; docs local HIT | normalized output matched | **PASS** |
| C3 | `packages/ui/src/button.tsx` | docs/web MISS | normalized output matched | **PASS** |
| C4 | exclude `app/page.tsx`, then change web page | docs/web local HIT with reused hashes | normalized output differed meaningfully | **MISMATCH** (injection detected) |

C4 is a successful CacheTrust detection of deliberately incorrect input configuration. It is not a
claim that correctly configured Turborepo 2.10.12 is faulty.

## C1 — same input

C1 reuses the Step B evidence. After deleting both output trees, the second run reported local HIT
for `docs#build` and `web#build`. Its 310-file raw manifest exactly matched the initial cached
artifact, while the normalized output also matched independent clean builds.

Verdict: **PASS**. A real local HIT occurred and the semantic result agreed with independent builds.

## C2 — application source change

Changed file: `apps/web/app/page.tsx`

```diff
-          <li>Save and see your changes instantly.</li>
+          <li>CACHE_TRUST_C2_V2 source change detected.</li>
```

| Task | v1 | v2 cached run | v2 independent baseline |
| --- | --- | --- | --- |
| `docs#build` | `6d81d2f140cad23b` MISS | same hash, local HIT | same hash, MISS in empty cache |
| `web#build` | `41ae4b5e2f67928e` MISS | `047451cd3f8fffec` MISS | `047451cd3f8fffec` MISS |

- Cached-run raw manifest: `91a5b79272b43834219c607fa6a2b462a53cab672a33a5cf7d774e0d4c123b6b`
- Baseline raw manifest: `b34f723f3174c72207e6b0454d33844c134da0b26c377c8286596e6a13f26c59`
- Both normalized manifests: `acc38cf36c387634a6f2762d1cf27f7f272b3b4e1026b2ed098478bace71e212`

The v2 marker was present in cached-run and baseline HTML/RSC output. Only the changed web task was
invalidated; the unrelated docs task was correctly restored from local cache.

Verdict: **PASS**.

## C3 — shared UI dependency change

Changed file: `packages/ui/src/button.tsx`

```diff
-      onClick={() => alert(`Hello from your ${appName} app!`)}
+      onClick={() => alert(`CACHE_TRUST_C3_V2 shared UI for ${appName}`)}
```

`@repo/ui` has no `build` task, but both applications import its source. Turbo correctly included
that dependency source in both consumer hashes:

| Task | v1 | v2 cached run | v2 independent baseline |
| --- | --- | --- | --- |
| `docs#build` | `6d81d2f140cad23b` MISS | `b3552379525545f4` MISS | same v2 hash, MISS |
| `web#build` | `41ae4b5e2f67928e` MISS | `bd459ef9d5aca530` MISS | same v2 hash, MISS |

- Cached-run raw manifest: `2c070647e68f99770f7699b010b09496aa89d3b2c6e112827f6d1cd11594809a`
- Baseline raw manifest: `2d862acc9903a537ea093e344ea6baa62257ae77228114acce117df26426d156`
- Both normalized manifests: `5fa662bfa1f577a6d687128b5a89aad99feb0577dce8c737d76b9d630bf46fac`

The marker was present in the emitted client chunk for both consumers and in the independent
baseline. Raw fingerprints differed only because of the previously documented Next.js
nondeterminism.

Verdict: **PASS**.

## C4 — deliberate missing input

The faulty configuration was applied before the v1 cache was created and remained unchanged for
every C4 run:

```diff
-      "inputs": ["$TURBO_DEFAULT$", ".env*"],
+      "inputs": ["$TURBO_DEFAULT$", ".env*", "!app/page.tsx"],
```

Then `apps/web/app/page.tsx` changed from the v1 text to:

```text
CACHE_TRUST_C4_V2 must appear in a correct build.
```

| Task | v1 | v2 cached run | v2 independent baseline |
| --- | --- | --- | --- |
| `docs#build` | `4f5b83823a362943` MISS | same hash, local HIT | same hash, MISS in empty cache |
| `web#build` | `81becf9272865116` MISS | same hash, local HIT | same hash, MISS in empty cache |

The v2 cached run restored the v1 raw and normalized fingerprints exactly:

- v1/cache raw: `7eb476409829aeddc841d6d11192a957380a62cd93db0c11e3651d8259b65a85`
- v1/cache normalized: `9a55674b366a26d0ca33182aa3e5e210dd2f921ab4664c1ff3b13ce67a501dc7`

The independent v2 baseline produced:

- raw: `7bda5b86febedf322f1115b5b0d423324f369ae711d279f4506a7613798413a5`
- normalized: `ff65a9aba33854bf64c2e5c1480c23006bbcff4b904859636653a7ace44e438f`

Direct content evidence:

- cached output: v2 marker absent; v1 text present;
- independent v2 baseline: v2 marker present; v1 text absent;
- eight normalized deployable files differed, including `index.html`, RSC/segment output, the SSR
  chunk and source map, and their output manifests.

This satisfies every MISMATCH precondition: the erroneous configuration was fixed before caching,
the same task hash was reused, an actual local HIT occurred, and an isolated v2 build demonstrated a
meaningful application-output difference that survives normalization.

Verdict: **MISMATCH**, meaning the deliberate fault was successfully detected.

## Runtime observations

| Run | Duration | Observed peak Node working set |
| --- | ---: | ---: |
| C2 v1 | 30.807 s | 2.630 GiB |
| C2 v2 cache | 21.029 s | 1.395 GiB |
| C2 v2 baseline | 21.868 s | 2.609 GiB |
| C3 v1 | 31.514 s | 2.408 GiB |
| C3 v2 cache | 25.790 s | 2.517 GiB |
| C3 v2 baseline | 20.044 s | 2.728 GiB |
| C4 v1 | 22.787 s | 2.572 GiB |
| C4 v2 cache | 2.527 s | 0.170 GiB |
| C4 v2 baseline | 16.757 s | 2.501 GiB |

No build timed out or exhausted memory. The first sandbox-only offline install attempt could not
create pnpm's workspace-registration symlink (`EPERM`); the same offline frozen install succeeded
with normal Windows symlink permission. No network fetch or lockfile update was used.

## Step D requirements derived from the experiments

1. **Explicit isolation:** create pristine experiment and baseline workspaces, distinct local cache
   directories, and remove declared outputs before each run. `--force` is insufficient.
2. **Toolchain control:** honor the project's package-manager version and ensure Turbo child tasks
   resolve that exact executable, not merely the parent CLI invocation.
3. **Turbo evidence:** require summary JSON with task IDs, hashes, HIT/MISS, and local/remote state.
   A mismatch cannot be reported without an actual HIT.
4. **Mutation contract:** record the changed file, before/after diff, order of configuration and
   mutation, and a marker or equivalent proof that the change affects independent output.
5. **Consumer propagation:** support packages without their own task; verify affected consumer task
   hashes rather than assuming every dependency has a build task.
6. **Two-layer fingerprints:** always retain raw per-file hashes, then apply a named, auditable
   normalization policy. Normalizers must be project/framework-specific rather than hard-coded into
   the generic comparison engine.
7. **Semantic guardrails:** normalizers may remove random identities, secrets, and diagnostic traces
   but must never erase mutated application content. Report the post-normalization changed-file set.
8. **Determinism gate:** prove the normalized baseline is stable before allowing PASS or MISMATCH;
   otherwise return INCONCLUSIVE.
9. **Verdict precedence:** environment/build failure → ENVIRONMENT_ERROR; missing HIT or unstable
   baseline → INCONCLUSIVE; HIT plus meaningful normalized difference → MISMATCH; otherwise PASS.
10. **Evidence schema:** persist environment, commands, durations, observed memory, source/config
    diffs, summaries, raw and normalized manifests, marker checks, and the final rationale.

## Evidence

`evidence/phase3-step-c/` contains:

- `results.json`, the compact machine-readable verdict and preconditions;
- source and injected-config diffs;
- run stdout/stderr, metrics, and Turbo summary JSON;
- raw and normalized per-file manifests;
- offline-install logs;
- the exact measurement and fingerprint scripts used for reproduction.
