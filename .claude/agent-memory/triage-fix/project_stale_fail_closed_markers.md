---
name: stale-fail-closed-markers
description: check-conformance-evidence.mjs and governance tests assert literal source strings (e.g. process.exit(1)) that go stale whenever the checked script's implementation idiom changes
metadata:
  type: project
---

`scripts/check-conformance-evidence.mjs` and several `test/packaging/wp6-*`
governance tests validate other scripts by asserting literal substrings/regex
(e.g. `"process.exit" + "(configuredExitCode)"`) are present in that script's
source text — not by asserting behavior. When a script's fail-closed
mechanism changes idiom (e.g. plain `process.exit(N)` → Effect's
`NodeRuntime.runMain(runScript(...))`), the marker goes stale and the checker
fails even though the script's real behavior is still correct (or, worse, can
pass while the real behavior silently changed — see the `beforeExit` case
below).

**Why it matters:** on 2026-07-30, three of five failing verify gates traced
back to this pattern: `release-via-tag.mjs` and
`run-conformance-authorization.mjs` were migrated to
`NodeRuntime.runMain(runScript(...))`, and both the checker and a governance
test still grepped for the old `process.exit(N)` string. Separately,
`generate-release-provenance.mjs` was deliberately redesigned (real SLSA
provenance now comes from npm's native `--provenance` flag, asserted
elsewhere in the same checker against release.yml) but the checker still
grepped for 7 markers from the abandoned custom-SLSA-generation design.

**How to apply:** when a `check:conformance-evidence` or `wp6-auth-governance`
failure names a specific missing string in a script, don't assume the script
regressed — read the actual current script first. If its fail-closed/behavior
guarantee still holds under a different idiom, update the marker to match
(prefer a marker on the *guarantee*, e.g. `configuredExitCode !== 0`, over the
literal call syntax). Two important exceptions found the same day:
1. `NodeRuntime.runMain`'s default teardown skips `process.exit()` on a
   zero-code success (lets the event loop drain naturally, firing
   `beforeExit`) — if a hardening test asserts zero `beforeExit`/`exit`
   listener activity, you need a real code fix (custom `teardown` option),
   not just a marker update. See `scripts/run-conformance-authorization.mjs`.
2. Some scripts (see [[zero-dependency-scripts-pattern]]) must NOT be migrated
   to the Effect idiom at all, because they run with no node_modules
   installed.
