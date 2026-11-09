# Phase 3 Step E-Prep-2 — shadcn/ui Environment Readiness

Date: 2026-11-10 (Asia/Seoul)

## Decision

**E-Prep-2 result: CONDITIONAL GO for E1 preflight only. E-1 itself was not run and is not declared
PASS or complete.**

The exact source, package manager, frozen installation, Turbo version, task graph, output arrays,
E3 source precondition, and E-Prep-1 environment launch policy are ready. Runtime output inventory
is deliberately `NOT VERIFIED` because obtaining it requires the first real build. E1 must stop
after its first build if generated files escape the declared outputs or either expected `dist`
tree is empty.

No shadcn/ui build, CacheTrust verification, mutation, E1, E2, or E3 was executed.

## Pinned environment

| Item | Observed value | Result |
| --- | --- | --- |
| Repository | `shadcn-ui/ui` | PASS |
| Commit | `8ab27715521cbd4f87ae6886cd989cbb678f6de7` | PASS |
| Host Node | `v24.19.0`, `<program-files>/nodejs/node.exe` | PASS for package `>=20.18.1`; differs from `.nvmrc` 20.5.1 |
| Corepack | 0.35.0 | PASS |
| Declared package manager | `pnpm@10.33.4` | PASS |
| Provisioned package manager | pnpm 10.33.4 in an isolated `COREPACK_HOME` | PASS |
| Global pnpm | 11.20.0, observed but not used or changed | PASS |
| Installed Turbo | 2.9.18 | PASS |
| Lockfile SHA-256 | `095aa7494a673e4b15b963a3263bcbc1d025176b00f97406aa61c9893827b862` | PASS |

The E-0 sparse checkout was no longer available. A fresh filtered checkout was created under a
redacted system-temporary root, and a second short-path local clone was used for installation.
Both the source checkout and install workspace were Git-clean after the dry-run. The CacheTrust
repository and source checkout were not used as install targets.

## Resource and isolation preflight

The checkout contained 6,444 files and occupied 78,850,885 bytes before installation. The lockfile
was 727,757 bytes; 80 `package.json` files were present, while the root workspace definition still
selects the six workspaces identified in E-0. Git reported no symlinks or submodules.

Before installation the host exposed 15.70 GiB total RAM, 2.88 GiB free RAM, and 164.56 GiB free on
C:. The low free-RAM value made parallel or multi-workspace installation unacceptable, but one
sequential short-path workspace was accepted because the disk margin was large and failure would
be confined to an owned temporary directory.

During installation, observed free RAM fell to approximately 1.03 GiB. The observed pnpm Node
process peaked at 1,213.7 MiB working set. This is not a complete process-tree peak measurement.
After installation, free RAM was 1.75 GiB and C: free space was 162.83 GiB. The install workspace
grew by 1,268,592,453 bytes to 1,347,443,338 bytes. The C: delta additionally includes the isolated
Corepack store and temporary source clone.

Resource conclusion: one controlled install was acceptable and completed, but the low RAM margin
supports E-0's requirement that future scenario work remain sequential. It does not justify
parallel E1/E2/E3 workspaces or builds.

## pnpm provisioning and environment contract

The global pnpm 11.20.0 was not used. Corepack 0.35.0 provisioned the exact version into an isolated
temporary `COREPACK_HOME` without enabling, replacing, or upgrading the system-global pnpm:

```text
corepack pnpm@10.33.4 --version
10.33.4
```

The frozen install and direct Turbo dry-run used the E-Prep-1 merge model: inherited environment
plus explicit overrides. Public fixed values were `CI=true`, `FORCE_COLOR=0`,
`NODE_ENV=production`, `NO_COLOR=1`, and `PUPPETEER_SKIP_DOWNLOAD=true`. Declared build variables,
credential-like variables, proxy variants, `npm_config_user_agent`, and Turbo remote-cache
variables were explicitly set to empty strings. No ambient or private values are stored in durable
evidence.

The direct Turbo invocation confirmed empty values for all task-declared variables. A preliminary
`pnpm exec turbo` dry-run showed that pnpm injects its own `npm_config_user_agent`; therefore the
durable result comes from the installed `node_modules/.bin/turbo` entry point, matching how
CacheTrust launches a configured Turbo command directly.

## Frozen install

The isolated install command was:

```text
corepack pnpm@10.33.4 install --frozen-lockfile
```

It completed in 4 minutes 16.7 seconds. pnpm reported `Done` using 10.33.4, the lockfile hash did
not change, the workspace remained Git-clean, and the installed Turbo 2.9.18 executed. The Windows
Corepack wrapper returned before its child pnpm process, so the wrapper exit code was not retained;
the completion line and postconditions are the success evidence.

`apps/v4` ran its `fumadocs-mdx` postinstall successfully. pnpm's build-approval policy ignored
scripts for three esbuild versions, msw, Puppeteer, and unrs-resolver; no Puppeteer browser download
occurred. pnpm warned that it could not create `shadcn` bin links in `apps/v4` and `packages/tests`
because `packages/shadcn/dist/index.js` did not exist before a build. This did not block direct
Turbo discovery and is expected to require re-evaluation only if a later workflow needs those
workspace-local bin links.

## Turbo dry-run and graph comparison

Only this non-building command was executed:

```text
node_modules/.bin/turbo run build --filter=shadcn... --dry=json
```

Turbo 2.9.18 reported exactly two packages and tasks:

```text
@shadcn/registry#build
          |
          v
     shadcn#build
```

`@shadcn/registry#build` had no dependencies and listed `shadcn#build` as its dependent.
`shadcn#build` listed registry as its sole dependency. Both commands resolve to `tsup`, both use
`dependsOn: ["^build"]`, and no extra task entered the closure. This exactly matches E-0; there is
no graph difference to reconcile.

## Output configuration audit

For both tasks, Turbo returned:

```json
{
  "outputs": [".next/**", "dist/**", "public/r/styles/**", "styles/**"],
  "excludedOutputs": [".next/cache/**"]
}
```

After prefixing by each task directory, this exactly matches the CacheTrust E-0 contract for
`packages/registry` and `packages/shadcn`. Order differences from the root `turbo.json` declaration
are set-equivalent and do not affect CacheTrust's exact set comparison. `expandedOutputs` remained
empty because no build outputs existed; this is not runtime output inventory.

## E3 contract check

`packages/registry/src/logger.ts` retained SHA-256
`6d8cc3391257b828d25fda1ff2cfa3b7ceb8ab69d0ee3a0e5baafa9f3260d285`. The representative import
remained at `packages/shadcn/src/utils/registry-api.ts:2`, and 32 non-test production source files
imported the registry logger. The E3 mutation contract is therefore unchanged.

## E-1 entry-condition matrix

| Condition | Status | Evidence / limitation |
| --- | --- | --- |
| Fixed SHA | PASS | Fresh clean checkout at the exact commit |
| pnpm 10.33.4 | PASS | Isolated Corepack provisioning; global pnpm untouched |
| Node compatibility | PASS | Node 24.19.0 satisfies package `>=20.18.1`; `.nvmrc` mismatch disclosed |
| Frozen install | PASS | Completed with unchanged lockfile and clean Git status |
| Windows resource acceptance | PASS, constrained | One sequential install fit; free RAM fell to about 1.03 GiB |
| Actual Turbo task graph | PASS | Exactly registry then shadcn under `shadcn...` |
| Exact output arrays | PASS | Includes and exclusion match E-0 for both tasks |
| E3 mutation contract | PASS | Hash, representative import, and 32 production imports preserved |
| E-Prep-1 environment alignment | PASS | Same inheritance/override model; public values and cleared names recorded |
| Actual output inventory | NOT VERIFIED | Requires the forbidden real build |

## Remaining risks and next gate

- A first real build must prove both `dist` trees are nonempty and inventory every generated or
  changed file against Turbo's declared outputs.
- E1 must remain sequential because the observed memory floor was low.
- The ignored dependency build scripts did not block dry-run, but a real tsup build may reveal a
  missing native/binary preparation; that would be an environment error, not permission to loosen
  the frozen install or change versions.
- The missing pre-build shadcn workspace bin links are not needed by the selected Turbo tasks but
  remain a documented install warning.
- CacheTrust will create three independent workspace installs for E1. This step measured only one;
  the combined time and transient resource pressure are not yet demonstrated.

The next authorized step may perform **E1 only**, beginning with its first-build output inventory
gate. E2 remains gated on E1 PASS, and E3 remains gated on E2 PASS. This document does not authorize
or claim those results.

Durable evidence:

- `evidence/phase3-step-e-prep-2/readiness.json`
- `evidence/phase3-step-e-prep-2/dry-run-summary.json`
- `evidence/phase3-step-e-prep-2/hashes.sha256`
