# Phase 3 Step D-2 — Windows dependency-isolation preflight

Experiment date: 2026-11-09 (Asia/Seoul)

## Decision

**GO** — the MVP will copy project sources without `node_modules` and perform an independent,
frozen installation in every disposable workspace using the project's pinned package-manager
version. Existing `node_modules` trees are never shared or copied as trusted isolation.

This establishes filesystem separation, not a sandbox for untrusted lifecycle scripts. The user
must trust the target project and its locked dependencies.

## Environment

- Windows NT `10.0.26300.0` (`cmd ver`: `10.0.26300.9711`)
- Node.js `24.19.0`
- Corepack `0.35.0`
- Cached pnpm `11.25.0`, invoked directly through Corepack's versioned cache
- Global pnpm `11.20.0` was observed but not used
- Exact filesystem type could not be read: `fsutil fsinfo volumeinfo C:` returned access denied
- Creating a symbolic link returned “Administrator privilege required”; the test process therefore
  cannot depend on Developer Mode or symbolic-link privilege
- Directory junction creation worked with normal host permission used for the experiment

The experiment used a disposable path outside the CacheTrust repository. Evidence below uses
logical names (`source`, `fresh-a`, and so on) rather than recording the personal path.

## Fixture

The fixture was a three-project pnpm workspace: root, `packages/app`, and workspace dependency
`packages/lib`. The app imported the library and printed the dependency's resolved real path.
pnpm generated a lockfile offline, then each candidate used:

```text
node <corepack-cache>/pnpm/11.25.0/bin/pnpm.mjs install \
  --offline --frozen-lockfile --ignore-scripts --dir <workspace>
```

`--ignore-scripts` made this fixture test safer; it is not evidence that arbitrary third-party
lifecycle scripts are sandboxed. The lockfile SHA-256 remained
`2c68616fbc52ade8c2b6c3a3d0e5c7db4e0a6d7cdf64e0a640f9da8fb302bb8`.

## Strategy A — independent installation

Three source-only copies were installed independently. Install durations were 0.80, 0.93, and
1.22 seconds. All frozen installs succeeded offline and left the lockfile unchanged.

pnpm created `packages/app/node_modules/@preflight/lib` as a junction whose target was the
corresponding copy's own `packages/lib`. `realpath` confirmed no dependency resolution escaped to
`source` or another copy.

Changing `fresh-a/packages/lib/index.js` changed only `fresh-a` resolution. The source hash and
`fresh-b` hash remained
`de90b3e4252d593ca455863af8c087f03bce65f88a1163e9b4f0fcddaf635735`.
Writing through the installed `packages/app/node_modules/@preflight/lib/index.js` junction also
changed only `fresh-a/packages/lib/index.js`; `source` and `fresh-b` retained the original content.
Concurrent app resolution in `fresh-a` and `fresh-b` returned their respective values, and separate
cache marker directories retained different owners.

Result: **accepted**.

## Strategy B — shared installed dependencies

A junction from `link-reuse/packages/app/node_modules` to the disposable source installation was
created. The app's dependency resolved to `source/packages/lib/index.js`, outside the isolated
copy. A build or mutation through that dependency path could therefore modify shared source state.

Result: **rejected**. A `node_modules` path inside the copy is not isolation when its junction chain
escapes the owned workspace.

## Strategy C — copy installed dependencies

PowerShell recursive copy dereferenced the workspace junction into a plain directory. Resolution
stayed inside the destination, but changing `copy-reuse/packages/lib/index.js` did not change the
library imported by the app: it continued to load the stale copied
`packages/app/node_modules/@preflight/lib/index.js`.

Reconstructing all package-manager links after copying is equivalent to reinstalling and is safer
when delegated to the pinned package manager.

Result: **rejected** as a generic reuse strategy.

## Safety checks

| Check | Result |
| --- | --- |
| Original source hashes unchanged after isolated mutation | PASS |
| Copy mutation does not affect source/other copy | PASS |
| Package resolution succeeds in each fresh copy | PASS |
| Junction targets and resolved paths inspected | PASS |
| No mutable dependency link into source | PASS for A; FAIL for B |
| Cleanup restricted to owned disposable root | PASS |
| Simulated-failure cleanup | PASS |
| Windows child process terminated before cleanup | PASS (`taskkill /T /F`) |
| Junction cleanup did not delete outside sentinel | PASS |
| Concurrent workspaces/caches remain separate | PASS |
| Lockfile unchanged | PASS |

The simulated-failure copy contained a running Node process and an escape junction to a sibling
sentinel. The process tree was terminated, the validated owned root was removed, and the sentinel
survived. The complete fixture occupied about 16 KiB because it used only a workspace dependency;
this does not predict real monorepo install disk use. No meaningful peak-memory measurement was
needed for these sub-second Node checks.

## Selected engine policy

1. Reject a dirty Git project before creating workspaces.
2. Reject source symlinks/junctions that cannot be proven to remain inside the source snapshot.
3. Copy tracked project content without `.git`, `node_modules`, outputs, or caches.
4. Run the explicitly configured pinned package-manager install independently and sequentially in
   the cache experiment and two baseline workspaces.
5. Require frozen-lockfile semantics in configuration and verify lockfile hashes before/after.
6. Reject installed dependency links whose resolved targets escape their workspace.
7. Use separate local Turbo cache directories and never use `--force` as the isolation proof.
8. Validate every cleanup target as a descendant of the owned temporary root and do not traverse
   escaping reparse points.

## Residual risks

- Package-manager lifecycle scripts execute with the user's permissions and may intentionally use
  absolute paths, network access, credentials, or external services. CacheTrust is not a sandbox.
- A shared content-addressed pnpm store may be used by pnpm. Installed project links must still
  resolve inside the workspace; the store is treated as package-manager-managed immutable content,
  not mutable project state.
- Antivirus/file indexing can delay Windows cleanup.
- The minimal fixture did not measure a real monorepo's installation time or disk amplification.
- Symbolic-link privilege is unavailable in this session, so the engine must fail closed rather
  than require it.

These limitations are acceptable for a local-project MVP only when the user trusts the project and
supplies a frozen install command for its pinned package manager.
