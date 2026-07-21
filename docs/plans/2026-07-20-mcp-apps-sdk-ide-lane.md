---
title: "plan: Keep MCP Apps SDK and IDE work on one explicit lane"
type: plan
date: 2026-07-20
status: proposed
---

# MCP Apps SDK and IDE lane

## Ownership

This worktree can own the MCP Apps work as a separate integration lane alongside MCP IDE authoring. The lane covers the SDK gaps needed for Apps resources and Views, then consumes those public APIs in the IDE for lifecycle visualization and a sandboxed Host/View preview.

## Boundary

- Land or integrate stable server/View support at the SDK layer before binding the IDE to it.
- Keep stable and preview Apps profiles explicit; never infer a profile from a shared extension identifier.
- Add preview Host behavior behind a separate typed surface and capability check.
- Represent Apps traffic through the existing `apps` trace channel and `app-host`, `app-view`, and `app-resource` graph nodes.
- Keep browser/React/Next dependencies inside `visual-effect/`; the root SDK exposes protocol and lifecycle contracts only.
- Preserve host policy, consent, sandboxing, origin, and resource-integrity boundaries in both SDK tests and IDE preview behavior.

## Sequence

1. Reconcile with the SDK branch after the prerequisite server surface is stable.
2. Add focused SDK contract tests for stable Apps resources/View behavior.
3. Add preview Host APIs and lifecycle tests without weakening the stable profile.
4. Add normalized Apps trace adapters.
5. Add resource linkage and lifecycle projection to the graph.
6. Add a sandboxed local Host/View preview with visible policy and profile state.

If the SDK work exposes a larger protocol or security boundary than this sequence contains, stop at the public contract and split Host preview into a follow-on rather than coupling it to authoring internals.
