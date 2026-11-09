# Phase 3 Step E-Prep-1 — Install Environment Contract

Date: 2026-11-09 (Asia/Seoul)

## Result

The CLI now accepts an optional install-environment override, applies one environment snapshot to
the package-manager version probe and all three frozen installs, and records a deliberately limited
install-environment contract in verification evidence. Existing configurations remain valid and
retain their previous inherited-environment behavior.

This step did not install shadcn/ui, run a Turbo dry-run, build an external repository, or execute
E1/E2/E3. Completion of this step does not make E-1 GO.

## Previous contract and implementation gap

Before this change, `install` described the executable, version probe, frozen-install arguments,
lockfiles, and timeout. Both the version probe and installs inherited `process.env`, but there was
no configuration field for overrides. `turbo.environment` applied only to Turbo builds. Each of the
three independent workspaces ran the same install command, but the effective install environment
was ambient, unrecorded, and not explicitly tied to the earlier version probe. Evidence recorded
package-manager observations and install process metadata, but no install-environment keys or
policy.

This was the blocking E-0 gap: lifecycle behavior such as Puppeteer's download policy could not be
declared, audited, or shown to be consistent across the probe, cache workspace, and two baselines.

## Config schema change

`install.environment?: Record<string, string>` is additive and optional. Omitting it preserves the
old behavior. When present, every key and value is validated before Git inspection, version
probing, workspace creation, or installation:

- names must be nonempty and contain neither `=` nor a null byte;
- values must be strings and contain no null byte;
- on Windows, configured names must be unique ignoring case.

Unknown fields remain rejected. Frozen-lockfile enforcement, package-manager version enforcement,
timeouts, exit-code semantics, task expectations, and verdict rules are unchanged.

## Inheritance and override policy

The base environment is a snapshot of the CLI process environment. Configured entries override
that snapshot. Windows matching is case-insensitive, so overriding `PATH` removes an inherited
`Path` spelling rather than sending ambiguous duplicate names.

The snapshot used for package-manager resolution and the version probe is retained on the resolved
install invocation. The cache, baseline A, and baseline B installs all receive that same snapshot,
even if the parent process environment changes afterward. Empty string is a supported explicit
override and can therefore clear a variable without deleting the inherited-environment contract.

Turbo build environment behavior is unchanged and remains controlled separately by
`turbo.environment` plus the existing remote-cache clearing policy.

## Evidence and secret-protection policy

Schema `cachetrust.verification/1` is unchanged. A new optional `environment.install` object is
emitted by current writers, so older evidence without it remains valid to existing readers. It
records:

- that the ambient environment is inherited;
- whether configured overrides exist;
- the scope: package-manager probe plus cache, baseline A, and baseline B installs;
- that one environment snapshot is shared across those processes;
- configured variable names and whether each value is `public` or `private`.

Values are never recorded merely because they were configured. A value is public only when both
its name and value match a fixed low-risk allowlist: conventional boolean/color values for `CI`,
`FORCE_COLOR`, `NO_COLOR`, and `PUPPETEER_SKIP_DOWNLOAD`, or
`NODE_ENV=development|production|test`. All other configured values are private and recorded by
name only. Private values are not written verbatim or hashed. The complete inherited environment
is never enumerated or dumped. Install stdout/stderr continue to be excluded; existing aggregate
log metadata is unchanged.

Evidence cannot prove that lifecycle scripts did not reinterpret inherited variables or expose
them outside CacheTrust. It proves the CLI's declared override policy and process-launch scope, not
the behavior of trusted dependency scripts. This limitation is stated in evidence.

## Changed files

- `src/verification/config.ts`
- `src/verification/package-manager.ts`
- `src/verification/isolation.ts`
- `src/verification/evidence.ts`
- `src/verification/engine.ts`
- `test/verification-config.test.ts`
- `test/package-manager.test.ts`
- `test/verification-isolation.test.ts`
- `test/verification-engine.test.ts`
- `docs/phase3-step-e-prep-1.md`

`src/process.ts`, the E-0 documents/evidence, and lockfiles were not changed.

## Tests

Focused tests cover omission/backward compatibility, explicit overrides, inherited variables, one
snapshot across version probing and three installs, validation failures, private-value omission,
public-value evidence, additive evidence compatibility, and Windows case-insensitive replacement.
The existing D-4-style engine fixture also still reaches its original `MISMATCH` verdict.

Process termination and timeout tests were deliberately not executed. No external repository was
installed or built.

## D-4 compatibility

Existing D-4 configs omit `install.environment`, so they retain ambient inheritance and require no
changes. Independent workspace installs, lockfile hash checks, output coverage, normalization,
functional checks, baseline/cache isolation, evidence schema version, verdict precedence, and exit
codes are unchanged. The change neither relaxes verification nor promotes an inconclusive result.

## Known limitations

- Inherited variable names and values are intentionally absent from evidence.
- The fixed public-value allowlist is intentionally narrow; other reproducibility-relevant values
  remain private metadata and must be documented separately if their contents matter.
- Dependency lifecycle scripts remain trusted and unsandboxed.
- This step does not validate pnpm provisioning, frozen installation against shadcn/ui, Turbo's
  actual task graph, resource use, build determinism, or runtime output inventory.

## Next-step entry conditions

This implementation must pass focused tests, typecheck, project build, and final diff checks. Even
after that, E-1 remains NO-GO until the separate E-0 prerequisites are satisfied: exact pnpm
10.33.4 provisioning, a controlled frozen install, Turbo dry-run confirmation, resource
acceptance, and first-build output inventory. Those checks belong to a later explicitly authorized
step.
