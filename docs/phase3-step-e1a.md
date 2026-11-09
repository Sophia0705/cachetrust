# Phase 3 Step E-1A — First Build and Output Inventory

Date: 2026-11-10 (Asia/Seoul)

## Decision

**NO-GO.** The resource gate passed, but the one permitted build invocation was rejected by Turbo
2.9.18 during CLI argument validation. No task ran, no build output was generated, and the command
was not retried. E1 full verification cannot begin from this result.

This is a command-contract failure in E-1A preparation, not a CacheTrust engine result and not a
shadcn/ui build failure. E1, E2, and E3 were not executed.

## Preserved target state

The E-Prep-2 install workspace existed and remained suitable before invocation:

- repository commit: `8ab27715521cbd4f87ae6886cd989cbb678f6de7`;
- lockfile SHA-256: `095aa7494a673e4b15b963a3263bcbc1d025176b00f97406aa61c9893827b862`;
- Node: v24.19.0;
- pnpm: 10.33.4 from the isolated Corepack provisioning;
- installed Turbo package and native executable: 2.9.18;
- Git status: clean;
- installed dependencies: present;
- both expected `dist` roots: absent before invocation.

An initial Turbo probe reported an unrelated 2.11.9 because it resolved through the caller's
working-directory context. Inspection of the preserved workspace package, pnpm link, lockfile, and
the native workspace executable all confirmed 2.9.18; the native executable returned 2.9.18 with
exit code 0. The build attempt therefore used the exact native 2.9.18 executable.

## Resource gate

Immediately before the attempt:

| Measurement | Observed | Required | Result |
| --- | ---: | ---: | --- |
| Total RAM | 15.70 GiB | — | recorded |
| Available RAM | 5.61 GiB | at least 4 GiB | PASS |
| C: free space | 162.18 GiB | at least 8 GiB | PASS |
| Node processes | 7 | informational | recorded |
| Workspace size | 1,347,443,338 bytes | informational | recorded |

The workspace was isolated and clean, the task closure was limited by `shadcn...`, and no declared
output root existed. The resource gate therefore authorized one build invocation.

## Single invocation and failure

The command was executed once with concurrency one, a new dedicated cache path, and `--force` to
attempt to guarantee real task execution:

```text
<workspace>/.../turbo.exe run build --filter=shadcn... --concurrency=1 --force
  --cache=local:rw --cache-dir <workspace>/.cachetrust-e1a-turbo-cache
  --summarize --ui=stream --no-color
```

Turbo rejected the command before task execution:

```text
ERROR the argument '--force [<FORCE>]' cannot be used with '--cache <CACHE>'
```

- exit code: 1;
- elapsed time: 0.71 seconds;
- build command invocations: 1;
- Turbo task executions: 0;
- Turbo summary files created: 0;
- automatic retries: 0.

The maximum process working set was not measured because the Turbo process exited before the first
sample. Minimum observed available RAM was 5.44 GiB. Disk free space remained 162.17 GiB before and
after the attempt, with a measured delta of 0 MiB.

The failure was caused by combining two mutually exclusive Turbo options. Per the E-1A stop rule,
the command was not corrected and rerun. A future explicitly authorized attempt should use the
new, initially absent dedicated cache without `--force`; the absent cache already guarantees that
the selected tasks cannot be restored from that cache. This recommendation is not executed here.

## Output inventory

No output inventory is available because no task ran:

| Task | Output root | Exists | Files | Bytes |
| --- | --- | --- | ---: | ---: |
| `@shadcn/registry#build` | `packages/registry/dist` | no | 0 | 0 |
| `shadcn#build` | `packages/shadcn/dist` | no | 0 | 0 |

No raw output fingerprint could be captured. Symlink and abnormal-file-type checks are not
applicable to absent output trees.

## Turbo and CacheTrust coverage

The expected contract remains the E-Prep-2 dry-run result:

```json
{
  "outputs": [".next/**", "dist/**", "public/r/styles/**", "styles/**"],
  "excludedOutputs": [".next/cache/**"]
}
```

Actual coverage is **NOT VERIFIED**. With no generated files, E-1A cannot determine whether all
functional output is within Turbo outputs, whether CacheTrust fingerprints every necessary file,
whether exclusions contain files, whether task outputs remain separated at runtime, or whether
Windows path/case behavior introduces differences.

## Post-attempt integrity

After the failed invocation:

- the install workspace remained Git-clean;
- the lockfile hash was unchanged;
- neither `dist` root nor any other declared task output root existed;
- the requested dedicated cache directory was not created;
- no Turbo run summary was created;
- CacheTrust source and configuration were not changed.

## Entry-condition status

| Condition | Status |
| --- | --- |
| Preserved SHA, pnpm, Turbo, lockfile | PASS |
| Pre-build resource gate | PASS |
| Single real build | BLOCKED — CLI argument validation |
| Resource measurement during build | NOT VERIFIED — no build process |
| Registry output inventory | NOT VERIFIED |
| shadcn output inventory | NOT VERIFIED |
| Turbo output coverage | NOT VERIFIED |
| CacheTrust fingerprint coverage | NOT VERIFIED |
| E1 full verification readiness | NO-GO |

Another E-1A attempt requires explicit authorization because the single invocation allowed by this
step has already been consumed. E1 full verification, independent baselines, E2, and E3 remain
blocked.

Durable evidence:

- `evidence/phase3-step-e1a/build-result.json`
- `evidence/phase3-step-e1a/output-inventory.json`
- `evidence/phase3-step-e1a/coverage.json`
- `evidence/phase3-step-e1a/hashes.sha256`
