---
name: effect-foundation-collector-enoent-pattern
description:
  collectSourceFiles() in scripts/effect-foundation-policy.mjs crashes on
  tracked-but-deleted files; this repo has hit it twice
metadata:
  type: project
---

`collectSourceFiles()` in `scripts/effect-foundation-policy.mjs` (consumed by
`test/foundation/effect-foundation.test.mjs` and
`scripts/check-effect-foundation.mjs`) runs `git ls-files` then `readFileSync`s
every tracked path. `git ls-files` reports the INDEX, so a file deleted from the
working tree without staging the deletion (`git status` shows ` D path`,
unstaged) still appears and crashes the collector with ENOENT. Hit twice in this
repo's large parallel-agent branches:
`.claude/skills/effect-ts/scripts/build-index.mjs` (2026-07-ish, resolved before
this session) and `scripts/run-draft-e2e.mjs` (2026-07-30, fixed by me — see the
`flatMap` + `error.code === "ENOENT" ? [] : throw` guard in that function).

**Why:** In this repo's workflow, many agents fan out across one shared worktree
and delete/replace files without staging every deletion immediately; the policy
collector must tolerate that transient state rather than treat it as a genuine
unreadable-source failure.

**How to apply:** If `test:effect-foundation` or `check:effect-foundation` fails
with `ENOENT` opening some tracked path, first check
`git status --porcelain -- <path>` — if it shows unstaged ` D`, the fix is to
make the collector skip missing files (already done as of 2026-07-30), not to
touch the git index or add the file to `sourcePolicyExemptions`. If it recurs
after that fix, the collector itself has regressed.

Related: the `forbiddenSourcePatterns` regexes in the same file matched bare
string literals, not just import syntax — `scripts/vendor-effect.mjs`'s vendor
metadata table `["@effect/rpc", "packages/rpc"]` false-positived as an
`@effect/rpc` import. Only the `@effect/rpc` pattern was narrowed to an
import-context regex (`from `/`import(`/`require(` prefixed); the
`@effect/schema` pattern was left alone since no false positive was observed for
it — narrow the fix to what's actually broken, don't generalize speculatively.
