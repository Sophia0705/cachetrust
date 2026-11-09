# Phase 3 Step E-0 — shadcn/ui preflight research and verification design

Research date: 2026-11-09 (Asia/Seoul)

## Decision

**E-0 status: COMPLETE. E-1 execution status: NO-GO until the mandatory prerequisites below pass.**

The intended transition is to **CONDITIONAL GO for E1 only** after the install-environment support,
exact pnpm provisioning, controlled frozen install, and Turbo dry-run gates pass. E2 and E3 remain
sequentially gated behind E1 and E2 respectively.

The terminal verification target should be `shadcn#build`, selected with the dependency-inclusive
Turbo filter `shadcn...`. `@shadcn/registry#build` remains essential, but as the one real upstream
workspace task rather than the terminal target. This preserves the Step A intent and supports a
meaningful upstream-dependency mutation without manufacturing a relationship.

No dependency installation, lifecycle script, Turbo dry-run, production build, test suite, or
mutation was executed during E-0. Confirmed observations below come from the pinned Git tree and
the current CacheTrust implementation. Runtime claims are explicitly marked unverified.

## Pinned target and environment

The inspected source is [shadcn-ui/ui commit
8ab27715521cbd4f87ae6886cd989cbb678f6de7](https://github.com/shadcn-ui/ui/commit/8ab27715521cbd4f87ae6886cd989cbb678f6de7).
It was retrieved as a temporary partial sparse checkout outside the CacheTrust repository under
`<system-temp>/cachetrust-e0-shadcn-de60adb7ea684fbb9146df0939dca1b2`. The personal absolute path
is intentionally redacted. `git rev-parse HEAD` returned the exact requested SHA and the checkout
remained clean. No dependency installation, dry-run, build, test, or lifecycle script ran.

Small durable evidence is stored in:

- `evidence/phase3-step-e0/research.json`: checkout provenance, workspace names, static dependency,
  Turbo output, and E3 mutation facts;
- `evidence/phase3-step-e0/hashes.sha256`: SHA-256 values for the inspected manifests, lockfile,
  Turbo/tsup configuration, and the two E3 source files.

| Item | Confirmed value | Evidence |
| --- | --- | --- |
| Repository | `shadcn-ui/ui` | Git origin and pinned commit |
| Commit | `8ab27715521cbd4f87ae6886cd989cbb678f6de7` | `git rev-parse HEAD` |
| Host Node | `24.19.0` | local runtime |
| Preferred Node | `.nvmrc` is `v20.5.1` | `.nvmrc` |
| Package Node engine | `>=20.18.1` for both selected packages | package manifests |
| Package manager | `pnpm@10.33.4` | root `package.json#packageManager` |
| Lockfile | pnpm lockfile v9, SHA-256 `095aa7494a673e4b15b963a3263bcbc1d025176b00f97406aa61c9893827b862` | `pnpm-lock.yaml` |
| Turbo declaration | `^2.9.18` | root `package.json` |
| Turbo resolution | `2.9.18` | root lockfile importer and package snapshot |
| tsup resolution | `8.5.0` | lockfile |
| Workspace definitions | `apps/*`, `packages/*`, with test/fixture/temp exclusions | `pnpm-workspace.yaml` |

There is no conflict with Step A's recorded values. There is an upstream inconsistency worth
preserving: `.nvmrc` 20.5.1 is older than the selected packages' `>=20.18.1` engine. The installed
Node 24.19.0 satisfies the package engines but does not match `.nvmrc`. E-1 must record this choice
rather than claiming `.nvmrc` conformance.

The repository contains six workspace manifests: one app (`apps/v4`) and five packages
(`helpers`, `react`, `registry`, `shadcn`, and `tests`). The selected build closure contains only
the two packages below, but a root `pnpm install` still covers the full six-workspace install.

The exact pnpm 10.33.4 Corepack entry point is not currently present in the observed local Corepack
cache. E-1 must not substitute the global pnpm or another version.

## Statically derived expected task graph

### Static dependency evidence

`packages/shadcn/package.json` declares one workspace dependency:

```text
shadcn -> @shadcn/registry (workspace:*)
```

`packages/registry/package.json` declares no workspace dependencies. The lockfile resolves the
relationship as `link:../registry`. shadcn source imports and re-exports many public and internal
registry modules, so this is both a manifest dependency and an actual source dependency.

The root Turbo `build` task has `dependsOn: ["^build"]`. Both packages define `build: tsup`.
The expected task graph is therefore:

```text
@shadcn/registry#build
          |
          v
     shadcn#build
```

Expected order is registry first, then shadcn. E-1 should invoke Turbo directly:

```text
turbo run build --filter=shadcn...
```

The root `shadcn:build` script is `pnpm --filter=shadcn... build`, not a Turbo invocation. It is
appropriate for repository development but cannot provide the required Turbo summary, task hashes,
or HIT/MISS evidence. E-1 must not use it as the measured command.

### Dry-run limitation

No dependencies are installed in the research checkout and Turbo 2.9.18 is not available there.
A real `--dry=json` would therefore require provisioning pnpm and installing the locked graph.
E-0 did not perform that large installation. The graph above is confirmed statically; task IDs,
filter closure, output arrays, and Turbo version must still be confirmed by a post-install dry-run
before the first production build.

## Output coverage audit

The root Turbo `build` task declares the following task-relative outputs for every package:

```text
dist/**
.next/**
!.next/cache/**
public/r/styles/**
styles/**
```

The exact CacheTrust configuration contract is:

```json
[
  {
    "taskId": "@shadcn/registry#build",
    "include": [
      "packages/registry/dist/**",
      "packages/registry/.next/**",
      "packages/registry/public/r/styles/**",
      "packages/registry/styles/**"
    ],
    "exclude": ["packages/registry/.next/cache/**"]
  },
  {
    "taskId": "shadcn#build",
    "include": [
      "packages/shadcn/dist/**",
      "packages/shadcn/.next/**",
      "packages/shadcn/public/r/styles/**",
      "packages/shadcn/styles/**"
    ],
    "exclude": ["packages/shadcn/.next/cache/**"]
  }
]
```

Code inspection confirms that `src/verification/turbo-runner.ts` reads Turbo's `outputs` and
`excludedOutputs` separately, prefixes every pattern in both arrays with its task directory, and
then performs exact set comparison. `src/verification/outputs.ts` uses the same fully prefixed
include/exclude patterns for cleanup and fingerprinting. Omitting currently nonexistent roots
would therefore produce `OUTPUT_COVERAGE_MISMATCH`, not a false PASS. The two tasks use distinct
package roots, so their
configured output paths do not collide.

Static build-script evidence is narrower:

- registry `tsup.config.ts` emits all non-test `src/**/*.ts` entries, declarations, JavaScript, and
  shared chunks only under `packages/registry/dist`; `onSuccess` reads that directory but writes
  nothing elsewhere;
- shadcn `tsup.config.ts` emits its eight entries and declarations under `packages/shadcn/dist`,
  then copies `src/tailwind.css` to `dist/tailwind.css`;
- both production builds set `clean: true`, `sourcemap: false`, ESM, minification, and `outDir:
  "dist"`;
- package `files`/exports also identify `dist` as the publishable output;
- neither package has tracked files under its declared `.next`, `public/r/styles`, or `styles`
  output roots, so CacheTrust cleanup would not delete a confirmed tracked source path;
- `dist` and `.turbo` are ignored in both packages and no `dist` output is tracked.

No static write outside `dist` was found in either build command. This is strong preflight evidence,
but not runtime proof: E-1 must inventory changed/untracked files immediately after the first build
and compare that inventory to the Turbo summary. Any generated file outside the configured output
roots is a stop condition because it could create a false PASS. Empty `dist` is also a failure, not
a successful comparison.

## Hash-relevant environment

Turbo declares global `NODE_ENV` plus these build variables:

```text
NEXT_PUBLIC_APP_URL
UPSTASH_REDIS_REST_URL
UPSTASH_REDIS_REST_TOKEN
COMPONENTS_REGISTRY_URL
REGISTRY_URL
npm_config_user_agent
https_proxy
V0_URL
V0_EDIT_SECRET
DEPLOYMENT_PROTECTION_BYPASS
```

The selected tsup configs do not statically read these values, but Turbo hashes them. E-1 should
set `NODE_ENV=production` and explicitly clear every other listed value for all runs. Common
uppercase proxy variants should also be cleared at process launch so ambient proxy configuration
cannot affect lifecycle scripts or build behavior. Remote Turbo variables remain cleared by the
engine.

## Determinism and normalization policy

**Initial E-1 policy: no normalization.**

The Next.js BUILD_ID, preview/encryption-key, trace, and absolute project-root rules from Basic do
not apply to these tsup outputs. Static inspection found no timestamp generation, random ID,
source-map path, build manifest, or explicit absolute-path write. Source maps are disabled.

This does not prove byte determinism. E1 must compare two independent raw baselines first. If they
differ, retain both raw manifests and identify the exact files and fields. A normalization rule may
be proposed only after proving the value is nondeterministic, nonfunctional, narrowly scoped, and
unable to erase the E2/E3 marker. Until then the correct verdict is INCONCLUSIVE. No regex or
security-sensitive-value normalization is proposed.

## Minimal E-1 scenario set

### E1 — identical inputs

- Target/filter: `build`, `shadcn...`.
- Selected tasks: `@shadcn/registry#build`, `shadcn#build`.
- v1 expectation: both genuine MISS.
- cache-v2 expectation: both genuine local HIT with their v1 hashes.
- baselines: both tasks genuine MISS in two independent empty caches.
- comparison: raw outputs only; both nonempty `dist` trees included.
- verdict: PASS only if raw baselines are stable and cached output matches them.

### E2 — shadcn-local mutation

- Replace `packages/shadcn/src/tailwind.css` with a deterministic version containing a unique
  `CACHE_TRUST_E2` CSS comment or custom property.
- Expected cache-v2: `@shadcn/registry#build` HIT; `shadcn#build` MISS with a changed hash.
- Functional proof: marker exists in `packages/shadcn/dist/tailwind.css` in cache-v2 and both
  baselines.
- Comparison: complete output set against two raw clean baselines.

This file is preferred because the build explicitly copies it to a published output; mutation
effect does not depend on minifier tree-shaking.

### E3 — real upstream workspace mutation

The upstream package is `@shadcn/registry`; the downstream terminal package is `shadcn`.
`packages/shadcn/src/utils/registry-api.ts:2` imports `logger` from
`@shadcn/registry/internal/logger`, and 32 non-test shadcn source files contain that production
import at the pinned commit. The exact mutation contract is:

- file: `packages/registry/src/logger.ts`;
- precondition SHA-256: `6d8cc3391257b828d25fda1ff2cfa3b7ceb8ab69d0ee3a0e5baafa9f3260d285`;
- replace the exact line `export const logger = {` with:

  ```ts
  export const CACHE_TRUST_E3 = "CACHE_TRUST_E3"

  export const logger = {
  ```

- require exactly one replacement and record the post-mutation SHA-256;
- re-check the representative import and the source precondition before each prepared scenario;
- Expected cache-v2: both `@shadcn/registry#build` and downstream `shadcn#build` MISS with changed
  hashes because `build` depends on `^build`.
- Functional proof: the literal exists in `packages/registry/dist/logger.js` in cache-v2 and both
  baselines. Registry tsup makes every non-test `src/**/*.ts` file an entry, so `logger.js` is the
  exact expected output; E-1 must still verify that file rather than assume it was emitted.
- Do not require the marker in shadcn output: tsup may preserve registry as an external dependency,
  so downstream invalidation can be correct even when downstream bytes remain unchanged.
- Comparison: combined complete output set against two raw clean baselines.

This is a real dependency experiment. No faulty Turbo configuration or artificial stale-cache case
is proposed for Step E.

## Windows and resource assessment

The selected task graph is small (two tasks), but installation is not package-filtered by the
current engine. Each verification creates three complete source copies and performs three root
frozen installs. Running E1/E2/E3 separately therefore implies nine independent installs and twelve
Turbo invocations. These are execution-plan counts, not time or size estimates.

Observed free space was about 164 GiB, but no install footprint, build duration, or peak memory was
measured in E-0. Exact cost remains unknown. Run one controlled frozen install and dry-run before
authorizing all three scenarios.

Risks visible in the locked graph include:

- root `puppeteer`, whose lifecycle may download a browser unless download is explicitly disabled;
- native/optional packages including Turbo, several esbuild versions, and sharp;
- pnpm workspace links and Windows junction/symlink behavior;
- registry's own tsup config documents a Windows path-length failure above 260 characters;
- `minimumReleaseAge: 2880`, making the official lockfile and exact pnpm mandatory;
- dependency lifecycle scripts execute with user permissions and are not sandboxed by CacheTrust.

The pinned tree has no Git symlinks, submodules, or case-only path collisions, so the current source
copy gate has no known static blocker. Use a short owned root such as the D-4 short-path strategy,
run scenarios sequentially, keep Turbo concurrency conservative, and clean only validated owned
roots. Do not share mutable `node_modules`; sharing pnpm's immutable content-addressed store is not
the same as sharing workspace installations.

## CLI compatibility gap analysis

| Requirement | Classification | Finding |
| --- | --- | --- |
| Exact task IDs | Supported with configuration | Configure registry and shadcn task IDs; confirm by dry-run |
| Dependency-inclusive filter | Supported with configuration | `turbo.packages: ["shadcn..."]` becomes `--filter shadcn...` |
| Multi-task hashes/HIT/MISS | Supported | D-4 already proved multiple selected tasks |
| Exact output patterns | Supported with configuration | All five Turbo patterns must be prefixed for both tasks |
| Single-file E2/E3 mutations | Supported | Verified replace-file contract and SHA-256 preconditions |
| Functional marker checks | Supported | Text marker search under complete `dist` roots |
| pnpm 10.33.4 enforcement | Supported, prerequisite missing | Exact probe/install supported; version is not cached locally |
| Independent workspaces/caches | Supported | Three frozen installs and two clean baselines |
| No-normalization comparison | Supported | Raw manifests are the default |
| Evidence/verdict/exit codes | Supported | Schema v1 and PASS/INCONCLUSIVE/ENVIRONMENT_ERROR semantics fit |
| Root install environment | Blocking implementation gap | Install inherits ambient environment and evidence records no install env keys |
| Install scoping | Requires design change for optimization only | Current engine installs all six workspaces; correctness does not require a redesign |
| Runtime output inventory outside declared roots | Unsupported automatically | E-1 preflight must audit Git/untracked changes manually after first build |
| Peak memory measurement | Unsupported | Evidence records durations but not process-tree peak memory |

The root-install environment gap cannot be solved by the current public CLI configuration.
`turbo.environment` is applied only by `src/verification/turbo-runner.ts`. The install contract in
`src/verification/config.ts` has no environment field, and `src/verification/isolation.ts` invokes
each frozen install without an `env` option, so it inherits the operator shell unchanged. Evidence
also records no install-environment keys.

The minimum pre-E-1 implementation is an optional `install.environment: Record<string, string>`
field validated in `src/verification/config.ts`, passed to every install in
`src/verification/isolation.ts` on top of a deliberately defined base environment, and recorded by
key name plus a non-secret fixed-value policy in `src/verification/evidence.ts` and
`src/verification/engine.ts`. Tests must cover config validation, identical propagation to all
three installs, evidence redaction/no secret values, and rejection of non-string values. E-1 stays
NO-GO until that change passes typecheck, unit tests, and build. No implementation is made in E-0.

## Exact prerequisites for E-1

E-1 may begin only after all conditions below are satisfied:

1. Implement and verify the install-environment support described above. E-1 is blocked until it
   passes typecheck, unit tests, and build.
2. Provision Corepack-managed pnpm 10.33.4 with explicit network approval; verify the exact entry
   point and do not change the global pnpm setting.
3. Set and record `PUPPETEER_SKIP_DOWNLOAD=true` through that install environment for every
   isolated frozen install.
4. Prepare a complete clean checkout at the pinned commit in a short Windows path; verify no
   symlink/case collision and preserve the official lockfile hash above.
5. Perform one controlled `pnpm install --frozen-lockfile` with lifecycle/network behavior logged;
   record duration and disk delta instead of estimating them.
6. Run only `turbo run build --filter=shadcn... --dry=json` after installation. Confirm exactly the
   registry and shadcn build tasks, registry-before-shadcn dependency, Turbo 2.9.18, task IDs, and
   declared output/exclusion arrays.
7. Confirm the install and dry-run fit disk/memory constraints before creating three engine
   workspaces. If not, stop rather than weakening isolation.
8. Configure and record `NODE_ENV=production`; clear every declared build environment value,
   credential, proxy variant, and remote-cache setting.
9. Run E1 first with no normalization. After its first build, require nonempty `dist` trees and
   audit all generated files against Turbo's declared outputs. Any outside output or unstable raw
   baseline blocks E2/E3 pending analysis.
10. Run E2 only after E1 PASS. Run E3 only after E2 PASS and re-confirm the chosen registry source is
   actually imported by shadcn.

## Reproducible E-1 sequence

1. Verify source SHA, clean status, package/lock/config hashes, Node, pnpm, and Turbo versions.
2. Use a short external owned root and prepare clean scenario snapshots without modifying upstream.
3. Complete the controlled install/dry-run gates above.
4. Create public CacheTrust configs with the exact two task IDs and complete five-pattern output
   contract for each task.
5. Run E1 through `cachetrust verify`; archive its schema-v1 evidence immediately.
6. If E1 passes raw determinism and output coverage, create hash-pinned E2 replacement and run E2.
7. If E2 passes, create hash-pinned E3 replacement, re-check actual import evidence, and run E3.
8. Preserve raw manifests, Turbo summaries, cache locality/hash evidence, functional markers,
   install/build durations, source diffs, and all non-PASS attempts.
9. Remove only validated experiment-owned directories. Do not commit or push during execution.

## GO gate summary

The pinned source, static graph, exact output contract, and E3 mutation contract are now durably
grounded for planning. **The current decision is NO-GO for E-1 execution.** Exact pnpm provisioning,
the blocking install-environment implementation and tests, one controlled frozen install, Turbo
dry-run confirmation, resource acceptance, and first-build output inventory remain open. Once all
mandatory conditions pass, the decision may become CONDITIONAL GO for E1 only; E2 and E3 remain
sequentially gated.
