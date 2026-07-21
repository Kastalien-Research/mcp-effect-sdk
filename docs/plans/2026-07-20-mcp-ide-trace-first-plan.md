---
title: "feat: Establish the Effect MCP IDE graph and trace substrate"
type: feat
date: 2026-07-20
status: complete
---

# Establish the Effect MCP IDE graph and trace substrate

## Outcome

Deliver the first runnable checkpoint of the MCP IDE while preserving a direct path to editable graph authoring. A user can run, cancel, reset, and inspect a deterministic MCP process across a client, gateway, server, tool, and asynchronous Task. The rendered topology, node states, timeline, and inspector are all projections of versioned, UI-independent graph and trace documents.

## Scope Guardrails

- Import Visual Effect as an attributed application foundation and replace its example-gallery shell with an MCP IDE shell.
- Keep the application isolated from the root SDK package and its production dependencies.
- Do not modify the user-owned root `package.json` or `pnpm-lock.yaml` changes in this branch.
- Do not claim live SDK integration, editable authoring, Apps hosting, or a complete first pass in this checkpoint.
- Do not encode current pre-migration SDK APIs into the graph contract.

## Implementation Sequence

1. Import the clean Visual Effect source snapshot under `visual-effect/`, preserving its MIT license and upstream attribution.
2. Add the product brainstorm and operational README that distinguish the checkpoint from the complete first pass.
3. Write failing tests for graph validation, typed connection rules, deterministic trace ordering, cancellation, reset, and event-derived node state.
4. Implement the smallest versioned graph and trace modules that satisfy those tests, using Effect for validation/replay boundaries where it improves explicit error and interruption behavior.
5. Add a representative gateway + vertical server + Task fixture using stable IDs and realistic MCP JSON-RPC payloads.
6. Build the protocol-instrument IDE shell: topology canvas, mode marker, run controls, execution rail, event timeline, and selected-event/node inspector.
7. Reuse or adapt Visual Effect motion/state primitives where they improve causality; remove example-gallery assumptions from the active route.
8. Verify focused tests, full app tests, typecheck, static checks, production build, and an unscripted browser run at desktop and narrow widths.
9. Record the next authoring increment: graph mutation commands, typed palette, configuration inspector, undo/redo, and compiler seam.

## Checkpoint Acceptance

- The sample graph is a serializable document with a literal schema version.
- Invalid node references, duplicate IDs, and incompatible typed edges fail with legible errors.
- Trace events reference known graph nodes and replay in stable sequence order.
- Node execution state is derived solely from replayed events.
- Run visibly progresses through client, gateway, server, tool, and Task.
- Cancel produces cancelled/interrupted visual state without later completion.
- Reset returns the graph, timeline, and inspector to their initial state.
- Selecting a node or timeline event reveals exact protocol/runtime details.
- The UI clearly labels fixture replay and does not imply a live connection.
- App tests, typecheck, static checks, and production build pass.

## Complete-First-Pass Continuation

The next increment adds graph mutation commands and UI authoring on the same document: add/move/configure/connect/remove, command history, validation feedback, and import/export. The following increment adds the compiler and live SDK adapter. Tasks input-required/resume and Apps Host/View preview then extend the same node, edge, and event registries rather than introducing separate models.
