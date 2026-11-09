# Phase 3 Step E-1A — Resource Recheck and Single Build

Date: 2026-11-10 (Asia/Seoul)

## Decision

**CONDITIONAL GO for E1 full verification.** The single authorized E-1A build succeeded. Both
selected tasks executed as genuine cache misses, both `dist` trees were generated, and every raw
functional output file was covered by both Turbo outputs and the configured CacheTrust fingerprint
roots. This is not an E1 verdict: baseline independence, repeated raw determinism, and cache reuse
comparison remain unexecuted.

E1 full verification, E2, and E3 were not started.

## Starting state

The CacheTrust worktree started at `0f12e3315ed170d2ae979948d829b3d54cb998d7` with the prior
resource-blocked retry report and evidence untracked. Those files were preserved. The earlier E-1A
failure evidence was read and not modified.

After the device restart, the isolated host workspace was still present and clean:

- shadcn/ui commit `8ab27715521cbd4f87ae6886cd989cbb678f6de7`;
- lockfile SHA-256 `095aa7494a673e4b15b963a3263bcbc1d025176b00f97406aa61c9893827b862`;
- Node v24.19.0;
- isolated Corepack pnpm 10.33.4;
- workspace-context Turbo 2.9.18;
- absent dedicated retry cache;
- absent registry and shadcn `dist` roots.

No reinstall, source edit, lockfile edit, process termination, or system-setting change occurred.

## Resource gate

Host-context available RAM was measured twice at a ten-second interval:

| Measurement | Observed | Required | Result |
| --- | ---: | ---: | --- |
| Available RAM, first | 4.465 GiB | at least 4 GiB | PASS |
| Available RAM, second | 4.458 GiB | at least 4 GiB | PASS |
| C: free space | 164.20 GiB | at least 8 GiB | PASS |
| Node processes | 4 | informational | recorded |

Both RAM observations passed without lowering the threshold or terminating another process.

## Exact command and result

The previous invalid command was changed only by removing `--force`:

```text
<workspace>/.../turbo.exe run build --filter=shadcn... --concurrency=1
  --cache=local:rw --cache-dir <workspace>/.cachetrust-e1a-turbo-cache
  --summarize --ui=stream --no-color
```

The cache path was absent before invocation. The command ran exactly once with Turbo 2.9.18 and
reported:

```text
Tasks:  2 successful, 2 total
Cached: 0 cached, 2 total
Time:   1m2.829s
```

Task evidence from the Turbo summary:

| Task | Hash | Status | Local | Remote |
| --- | --- | --- | --- | --- |
| `@shadcn/registry#build` | `b6cb49eea13ef30a` | MISS | false | false |
| `shadcn#build` | `131819de6bf1f994` | MISS | false | false |

There was one build invocation, two task executions, and no retry. The shadcn task emitted a pnpm
configuration deprecation warning, but both ESM and declaration builds succeeded.

The monitoring wrapper returned before its buffered peak-working-set and minimum-free-RAM values
were retained, so those two during-build measurements are recorded as `NOT MEASURED` rather than
estimated. C: free space was 161.66 GiB at the later inventory observation; its difference from the
pre-build value includes the dedicated Turbo cache and unrelated host activity.

## Raw output inventory

| Task | Root | Files | Bytes | Manifest SHA-256 |
| --- | --- | ---: | ---: | --- |
| `@shadcn/registry#build` | `packages/registry/dist` | 252 | 665,485 | `f9d096163214847fbe0899917d6d1f2e95bb6bdfbc8a3e602303ad4dcdb84c9a` |
| `shadcn#build` | `packages/shadcn/dist` | 18 | 207,838 | `b3841c44d8a4f082272c65119dcef82b8cdd8af15785c1e43a0a7f12ba59f97a` |

Each manifest contains sorted relative paths, byte counts, and SHA-256 hashes over unmodified raw
file bytes. The registry output contains the required `logger.js`; shadcn contains `index.js`,
`index.d.ts`, and `tailwind.css`. No symlink or reparse point was found in either tree.

## Turbo and CacheTrust coverage

Turbo reported the same task-relative contract confirmed in E-Prep-2:

```json
{
  "outputs": [".next/**", "dist/**", "public/r/styles/**", "styles/**"],
  "excludedOutputs": [".next/cache/**"]
}
```

All 270 functional files and 873,323 bytes were inside the two separate `dist/**` roots. Those
roots are included by both Turbo and the exact CacheTrust configuration. No files were generated
under `.next`, `public/r/styles`, or `styles`; consequently no excluded `.next/cache` file existed.
There were no duplicate relative functional paths, root overlap, symlink, reparse point, or
case-only collision. CacheTrust's portable-path comparison normalizes Windows separators before
matching the configured paths.

Turbo additionally generated its dedicated cache, run summary, and per-task `.turbo` logs. These
are nonfunctional execution infrastructure, not published build artifacts, and are intentionally
outside CacheTrust output fingerprints. No other build-time file was observed outside the declared
functional roots and those Turbo-owned locations.

Coverage result: **PASS for the first-build functional output inventory.** This result does not
establish output determinism or correct cache reuse.

## Integrity and remaining gates

The source worktree and lockfile remained unchanged. The only untracked workspace path is the
dedicated E-1A cache; `dist` and Turbo logs remain ignored as expected.

E1 may proceed only through a separately authorized full verification that creates independent
workspaces/baselines and compares raw outputs. E2 remains gated on E1 PASS, and E3 remains gated on
E2 PASS. This step provides no E1/E2/E3 verdict.

New durable evidence:

- `evidence/phase3-step-e1a-recheck/build-result.json`
- `evidence/phase3-step-e1a-recheck/output-inventory.json`
- `evidence/phase3-step-e1a-recheck/coverage.json`
- `evidence/phase3-step-e1a-recheck/hashes.sha256`
