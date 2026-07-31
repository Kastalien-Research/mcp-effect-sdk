---
name: conformance-skips-are-behavior-conditional
description: The upstream MCP conformance harness emits SKIPPED when our client never sent that request, so "upstream-declared" skips are conditional on our own behavior
metadata:
  type: reference
---

In `@modelcontextprotocol/conformance`, a check with `status: "SKIPPED"` for the
SEP-2243 standard-header scenario means *our client never sent that request*,
not that upstream declared the requirement optional. The harness's `getChecks()`
pushes a SKIPPED entry for any method absent from its observed
`methodHeaderChecks` map, with the message "Client did not send a {method}
request; Mcp-Method header was not exercised for this method."

**Why this matters for audits:** the local classification
`upstream-declared-skipped-informational` (minted in
`scripts/readiness-evidence.mjs`) is accurate about the *source* of the skip
(upstream's own `status` string, which local code cannot forge — FAILURE is
counted on a separate branch) but the word "informational" is a local
editorialization. Skipped checks are removed from the `applicableCheckCount`
denominator, so a "100% of applicable checks" pass rate has a denominator our
own implementation influenced.

**How to apply:** this cannot mask a real failure — a sent-but-wrong header
yields FAILURE, which is blocking — so treat it as advisory, not blocking. But
when a skip appears for a method the SDK should always send, verify the SDK
actually emits the header before accepting the exclusion. Related:
[[reverify-after-final-docs-commit]].
