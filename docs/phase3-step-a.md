# Phase 3 Step A — upstream and environment baseline

Research date: 2026-11-08 (Asia/Seoul)

This document fixes the upstream inputs for Phase 3. The repositories have not been cloned or
installed yet. All changes used by later experiments must happen in disposable copies outside the
tracked CacheTrust tree.

## Local baseline

- CacheTrust base: `dcd4f48e65ab5497025323f8c8cdd60a660ab285`
- Branch: `codex/phase-3-real-world-verification`
- OS: Windows, 16 GB RAM
- Node.js: `24.19.0`
- npm: `10.8.1`
- globally available pnpm: `11.20.0`
- free space observed on drive C: 166.3 GiB

The global pnpm version does not match any selected upstream. Later steps must invoke the exact
`packageManager` version through Corepack without changing the user's global pnpm configuration.

## Fixed upstream revisions

| Project | Revision | License | Required toolchain |
| --- | --- | --- | --- |
| [Turborepo](https://github.com/vercel/turborepo/commit/17691acd9bc80171e5ef4b3532ff0748ba231813) `examples/basic` | `17691acd9bc80171e5ef4b3532ff0748ba231813` | MIT | Node `>=24`, pnpm `11.25.0`, Turbo `2.10.12` |
| [shadcn/ui](https://github.com/shadcn-ui/ui/commit/8ab27715521cbd4f87ae6886cd989cbb678f6de7) | `8ab27715521cbd4f87ae6886cd989cbb678f6de7` | MIT | `.nvmrc` `20.5.1`; selected packages require Node `>=20.18.1`; pnpm `10.33.4`; Turbo range `^2.9.18` resolved by its lockfile |
| [Astro](https://github.com/withastro/astro/commit/39ede5f061297fdda7af945aa8e576f625ab5152) | `39ede5f061297fdda7af945aa8e576f625ab5152` | MIT (with notices in `LICENSE`) | Node engine `>=22.23.4`, `.nvmrc` `26.13.0`, pnpm `11.28.10`, Turbo range `^2.11.10` resolved by its lockfile |

The current Node version satisfies all declared engine ranges. It differs from the shadcn and Astro
`.nvmrc` preferences, so installation and a baseline build still have to prove compatibility.

## Turborepo Basic

Scope: the complete `examples/basic` workspace (`apps/web`, `apps/docs`, and packages under
`packages/*`). Use the example's own `pnpm-lock.yaml`; do not use the Turborepo repository root
toolchain or rebuild Turbo from Rust sources.

- Command: `pnpm build` (`turbo run build`)
- Graph: both Next.js applications consume `@repo/ui`, `@repo/eslint-config`, and
  `@repo/typescript-config`.
- Task dependency: `build` depends on `^build`.
- Inputs: `$TURBO_DEFAULT$` and `.env*`.
- Outputs: `.next/**`, excluding `.next/cache/**` and `.next/dev/**`.
- Declared build environment variables: none in `turbo.json`; ambient environment still needs to be
  normalized for independent-build comparisons.
- Windows outlook: compatible in principle; the commands are Node/Next/Turbo based. Two Next.js
  production builds make this the first real memory and duration measurement.
- Estimated Step B cost: low-to-medium; run sequentially and avoid concurrent projects.

This is the best engine-development target because it has two real consumers of one shared package,
explicit cached outputs, a small graph, and a Node requirement already met by the host.

## shadcn/ui

Selected scope: `shadcn` plus its dependency closure, especially `@shadcn/registry`. The intended
Turbo filter is `shadcn...`, matching the repository's own `shadcn:build` script.

- `shadcn` depends directly on workspace package `@shadcn/registry`.
- Both packages build with `tsup` and emit `dist/**`.
- Root `build` depends on `^build` and declares outputs `dist/**`, `.next/**`,
  `public/r/styles/**`, and `styles/**` (excluding `.next/cache/**`).
- Hash-affecting environment includes `NODE_ENV` plus the URL/token/proxy variables listed in
  `turbo.json`, including `REGISTRY_URL`, `COMPONENTS_REGISTRY_URL`, and `https_proxy`.
- No service is required for the selected package builds, but later experiments must clear or fix
  those variables so ambient credentials and proxy settings cannot affect comparison.
- The workspace uses `minimumReleaseAge`; the official lockfile is therefore mandatory.
- Windows outlook: selected `tsup` builds should work, while repository scripts such as
  `sync:templates` use a shell script and are out of scope.
- Estimated cost: medium installation, low-to-medium filtered build. Do not run the root build or
  registry application tests by default.

This pair is selected because it provides a direct real workspace dependency and deterministic
`dist` artifacts without requiring the large Next.js registry application.

## Astro

Selected scope: `@astrojs/markdown-remark` and its dependency closure, including
`@astrojs/internal-helpers` and `@astrojs/prism`, using a dependency-inclusive Turbo filter. The
exact closure must be confirmed with Turbo's dry-run graph after installation.

- Package build: `astro-scripts build "src/**/*.ts" && tsc -b`.
- Root `build` is intentionally not selected: it includes Astro core, integrations, language tools,
  and benchmark packages.
- `build` depends on `^build` and `prebuild`.
- Inputs explicitly exclude tests, e2e, performance data, `.astro`, `.cache`, `.turbo`, and generated
  `mod.js` files.
- Outputs are `dist/**/*`, `mod.js`, and `mod.js.map`, excluding `vendor/**`.
- Pass-through environment: `SKIP_OG` and `PUBLIC_TWO_LANG`. These must be normalized.
- Astro's pnpm workspace disables many dependency build scripts and applies trust-policy and
  minimum-release-age rules; the official lockfile and exact pnpm version are mandatory.
- Windows outlook: the selected scripts are Node-based, but the large dependency installation and
  native/optional packages make installation the main risk.
- Estimated cost: high installation, medium filtered build. Run only after Basic and shadcn, with a
  single project active and conservative Turbo concurrency.

`@astrojs/markdown-remark` is preferred over the core `astro` package because it still exercises a
multi-package dependency graph and real generated `dist` artifacts without forcing the largest core
build. If the dry-run closure is unexpectedly broad, `@astrojs/telemetry` is the lower-cost fallback,
but it offers a weaker shared-dependency experiment.

## Planned experiment matrix

| Project | Same input | Source change | Shared dependency change | Deliberate missing input |
| --- | --- | --- | --- | --- |
| Basic | Full build | one app source | `@repo/ui` source | copied `turbo.json` with one real input excluded |
| shadcn/ui | `shadcn...` | `shadcn` source | `@shadcn/registry` source | copied task config excluding the changed dependency input |
| Astro | selected filtered graph | markdown package source | internal helper or prism source | copied task config excluding the changed dependency input |

Each case remains provisional until its baseline build is deterministic and produces a trustworthy
Turbo summary. A missing-input case is reportable as `MISMATCH` only after an actual cache hit and an
output difference from an isolated no-cache baseline.

## Preparation and isolation plan

1. Prepare experiments under a separate ignored/untracked root, never under tracked fixtures.
2. Fetch the fixed SHA and create a clean source snapshot.
3. Keep one pristine snapshot and create disposable experiment/baseline copies from it.
4. Install with the official lockfile and the exact Corepack pnpm version (`--frozen-lockfile`).
5. Disable remote caching and assign a distinct local cache directory per experiment.
6. Normalize hash-relevant and pass-through environment variables.
7. Use Turbo summaries to record package hash and HIT/MISS state; fingerprint only declared output
   trees after removing excluded caches and nondeterministic metadata where justified.
8. Run projects sequentially. Record wall time and peak process-tree memory where Windows permits.

## Step A decision

Proceed to Step B with Basic only. The host Node version and disk space meet its declared baseline,
and its graph is suitably small. The remaining gate is obtaining pnpm 11.25.0 through Corepack and
successfully completing a frozen-lockfile install and deterministic initial build. Do not install
shadcn/ui or Astro until Basic passes.
