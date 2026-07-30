---
name: zero-dependency-scripts-pattern
description:
  Some scripts/*.mjs in mcp-effect-sdk must never import npm dependencies (not
  even `effect`) because their test harnesses run them with no node_modules
  installed
metadata:
  type: project
---

Two categories of scripts in this repo run in an environment with **no
node_modules at all**, and must therefore contain zero non-`node:*` imports:

1. Scripts shipped inside the published npm tarball that must fail closed before
   `npm install` ever runs (e.g. `scripts/release-via-tag.mjs`), verified by
   `test/packaging/wp5h-packed-core-consumer.test.mjs` running `npm run release`
   against the raw unpacked-but-uninstalled tarball and asserting
   `doesNotMatch(/MODULE_NOT_FOUND/)`.
2. Scripts copied alone into an isolated git-only fixture workspace by
   `test/source-refresh.integration.test.mjs` (`setupFixture`'s `copyFile`
   allowlist), which never runs `pnpm install` — e.g.
   `scripts/check-source-snapshots.mjs`.

**Why:** during the observability-spans branch's "align repository conventions"
pass, several scripts/\*.mjs were migrated wholesale to the Effect-idiomatic
`NodeRuntime.runMain(runScript(name, effect))` pattern (importing
`effect/Effect` + `@effect/platform-node/NodeRuntime` + `./lib/process.mjs`).
That's the right pattern for dev-only scripts (check-conformance-evidence.mjs,
generate-release-provenance.mjs, run-conformance-authorization.mjs), but two
scripts in the categories above got migrated too, breaking their zero-dependency
invariant with `ERR_MODULE_NOT_FOUND: Cannot find package 'effect'` — silent
until the specific isolated-workspace test runs.

**How to apply:** before adding an `effect`/`@effect/platform-node` import to
any `scripts/*.mjs`, check whether it's referenced by
`test/packaging/wp5h-packed-core-consumer.test.mjs` or
`test/source-refresh.integration.test.mjs`'s fixture `copyFile` list. If so,
keep it dependency-free (plain `console.error` + `process.exit(code)`, no
imports beyond `node:*`). See [[stale-fail-closed-markers]] for the paired
checker-marker pitfall this pattern causes.
