# CacheTrust

CacheTrust is a scenario-driven CLI for checking build-cache correctness. Phase 2 includes two
repeatable Turbo checks:

- `bracket-path` detects stale local hits caused by a literal `[id]` input path on Turbo 2.11.9.
- `mid-build-mutation` detects output saved under a stale pre-build hash on Turbo 2.11.8.

Requires Node.js 22 or newer.

```sh
npm install
npm run check
npm run build
node dist/cli.js --help
node dist/cli.js list
node dist/cli.js run --fixture path/to/fixture
node dist/cli.js run <scenario> --fixture path/to/fixture
node dist/cli.js run <scenario> --fixture path/to/fixture --evidence evidence.json
node dist/cli.js verify --config examples/cachetrust.config.json
```

`verify` reads a non-executable JSON configuration, checks the configured package-manager version,
and compares a cache-enabled build with two independently installed clean baselines. The target Git
repository must be clean, and the evidence destination must be outside the target project and must
not already exist. See `examples/cachetrust.config.json` and `docs/phase3-step-d3.md`.

Verification installs locked dependencies in disposable workspaces. This is not a security
sandbox: run it only for projects and dependencies you trust.

Scenarios implement `Scenario` from `src/scenario.ts` and are registered in the exported
`scenarios` array. Each scenario runs in isolated temporary workspaces, leaving the source fixture
unchanged. The optional evidence file stores the complete scenario result as JSON, including Turbo
stdout and stderr needed to reproduce and diagnose the run.

Exit codes distinguish the outcome: `0` for `PASS`, `1` for `MISMATCH`, `STALE_HIT`, or
`UNSAFE_SAVE`, `2` for `INCONCLUSIVE`, and `3` for `ENVIRONMENT_ERROR`.
