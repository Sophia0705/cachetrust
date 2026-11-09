# Step D-4 run summary

Final public CLI runs used Node 24.19.0, Corepack-managed pnpm 11.25.0, Turbo 2.10.12, and the
tracked `examples/basic` tree from upstream commit `17691acd9bc80171e5ef4b3532ff0748ba231813`.
The pnpm lockfile SHA-256 was
`ff8cfdf35e2cc167a1df052479441b736776b765cc931c2d69b4e23ab6b66c0e` in every case.

| Case | Public verdict | Exit | Cache-v2 observations | Baseline stable | Functional proof |
| --- | --- | ---: | --- | --- | --- |
| C1 | PASS / CORRECT_REUSE | 0 | docs HIT, web HIT | yes | same normalized output |
| C2 | PASS / CORRECT_REUSE, CORRECT_INVALIDATION | 0 | docs HIT, web MISS | yes | C2 marker in cache and both baselines |
| C3 | PASS / CORRECT_INVALIDATION | 0 | docs MISS, web MISS | yes | C3 marker in both apps, cache and both baselines |
| C4 | MISMATCH / CONFIRMED_STALE_REUSE | 1 | docs HIT, web HIT | yes | C4 marker absent from cache and present in both baselines |

Raw output fingerprints differ between independently built Next.js outputs and remain in each JSON
file. The normalized fingerprints are:

| Case | Cache | Baseline A | Baseline B |
| --- | --- | --- | --- |
| C1 | `4966cef423e1d8670618f6a43610a893022571a0d3d79424262c987e3d217204` | same | same |
| C2 | `07f80d99ed404a7328981f42b8eefe1cbeb15163a792d7564d5974a3813adfd6` | same | same |
| C3 | `3ed6c8d11409a49df9d2719236e118303cab1b75534608cd7931ebb47abadf6b` | same | same |
| C4 | `4966cef423e1d8670618f6a43610a893022571a0d3d79424262c987e3d217204` | `fa2cd870873913ac26533925ec7cb218bd1c5532d80b986f5aef0c88e8420262` | same as A |

Each JSON retains install and run command metadata, durations, task hashes, local/remote cache flags,
raw and normalized file manifests, functional-check matches, and stdout/stderr SHA-256 digests. Raw
logs are intentionally not retained by the public evidence schema.
