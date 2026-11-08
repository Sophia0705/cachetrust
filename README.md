# CacheTrust

CacheTrust is a scenario-driven CLI for checking build-cache correctness. Phase 1 provides the
shared execution engine; Turbo scenarios are intentionally deferred to Phase 2.

Requires Node.js 22 or newer.

```sh
npm install
npm run check
npm run build
node dist/cli.js --help
node dist/cli.js list
node dist/cli.js run --fixture path/to/fixture
node dist/cli.js run <scenario> --fixture path/to/fixture
```

Scenarios implement `Scenario` from `src/scenario.ts` and are registered in the exported
`scenarios` array. Each scenario receives the source fixture path and is responsible for using
`withTemporaryWorkspace` so the original fixture remains unchanged and its cache stays isolated.
