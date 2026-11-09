# Phase 3 Basic C1–C4 regression

Run `prepare.ps1` with a clean local `vercel/turborepo` checkout at commit
`17691acd9bc80171e5ef4b3532ff0748ba231813` and a new external runtime directory. The script uses
copies only Git-tracked `examples/basic` files into one isolated Git snapshot per case. The
disposable C4 target commits its intentional configuration fault normally, so every target passes
the engine's clean-input gate without hiding changes. The local snapshot commit is not presented as
the upstream commit; the preparation manifest and D-4 evidence retain the exact upstream provenance,
file hashes, and fault diff.

Prepend the generated `tools` directory to `PATH`, build CacheTrust, then invoke each runtime config
sequentially from `scenario`, copying each completed JSON file from runtime `evidence` into the
repository's `evidence/phase3-step-d4` directory. The configs use Corepack, the upstream frozen
lockfile, independent engine installations and caches, two clean baselines, and bounded timeouts.
The Turbo task environment disables pnpm's `verifyDepsBeforeRun` auto-install because dependencies
have already been installed independently with the frozen lockfile; leaving it enabled makes the two
parallel app scripts race while redundantly recreating the same workspace links on Windows.

The Next.js normalization policy is intentionally narrow: omit only each app's `trace` and
`trace-build`; derive and exactly replace only BUILD_ID, the server-action encryption key, and the
three preview-mode keys. BUILD_ID is also replaced in paths. Because independent engine workspaces
have different roots, the exact `outputFileTracingRoot` value is also derived from each app's
`required-server-files.json` and replaced only inside that app's `.next` tree. Raw manifests remain
in evidence.
