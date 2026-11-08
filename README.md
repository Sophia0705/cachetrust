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
```

Scenarios implement `Scenario` from `src/scenario.ts` and are registered in the exported
`scenarios` array. Each scenario runs in isolated temporary workspaces, leaving the source fixture
unchanged. The optional evidence file stores the complete scenario result as JSON, including Turbo
stdout and stderr needed to reproduce and diagnose the run.

Exit codes distinguish the outcome: `0` for `PASS`, `1` for a detected `STALE_HIT` or
`UNSAFE_SAVE`, `2` for `INCONCLUSIVE`, and `3` for `ENVIRONMENT_ERROR`.
