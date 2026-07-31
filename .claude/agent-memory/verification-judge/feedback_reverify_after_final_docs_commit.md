---
name: reverify-after-final-docs-commit
description: A "verify exit 0" claim must be re-checked at the exact audited commit, because prettier --check covers tracked .md files and verify runs lint as gate 2
metadata:
  type: feedback
---

When auditing a "`pnpm run verify` exit 0" claim, always re-run at the exact
audited commit rather than trusting the reported run — and specifically suspect
a final docs-only commit.

**Why:** On 2026-07-30 the tier-1 readiness claim for commit e919661 asserted
`pnpm run verify` exit 0. It was true at the parent commit, but e919661 itself
added `HANDOFF.md`, whose prose line-wrapping failed `prettier --check`.
`scripts/verify.mjs` runs `lint` (`eslint . && prettier --check .`) as its
second gate, so verify actually failed at the audited commit. The handoff
document asserting verify was green was the file that broke it, and nobody
re-ran verify after writing it.

**How to apply:** `prettier --check .` covers every tracked markdown file, so
any docs-only commit can break the verify gate even though no code changed.
When a producing agent reports verify green, check whether commits landed after
that run — `git log --diff-filter=A` on newly added files — and re-run `pnpm run
lint` directly, since it is cheap and fails fast compared to full verify.
Related: [[conformance-skips-are-behavior-conditional]].
