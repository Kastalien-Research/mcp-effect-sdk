# Verification Judge Memory

- [Re-verify after the final docs commit](feedback_reverify_after_final_docs_commit.md) — `prettier --check .` covers tracked .md, and verify runs lint as gate 2, so a docs-only commit can break a "verify green" claim.
- [Conformance skips are behavior-conditional](reference_conformance_skip_semantics.md) — upstream emits SKIPPED when our client never sent the request; "informational" is a local label.
