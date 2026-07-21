---
title: "feat: Add editable MCP graph authoring"
type: feat
date: 2026-07-20
status: complete
---

# Add editable MCP graph authoring

## Outcome

Turn the trace checkpoint into the first authoring increment without introducing a second topology model. Users can add, move, configure, connect, duplicate, and remove typed MCP nodes; undo and redo those operations; and see invalid wiring rejected with specific protocol guidance. Trace replay remains available against the same active graph and is blocked when an edit makes the fixture trace incompatible.

## Implementation Sequence

1. Specify immutable graph commands and history behavior with failing tests.
2. Implement add, move, configure, connect, duplicate, remove-node, and remove-edge commands over `McpGraphDocument`.
3. Validate every command result through the existing graph validator before committing it to history.
4. Add deterministic node/edge ID and palette-template helpers.
5. Add Author/Trace modes, a typed palette, undo/redo, draggable node positioning, connection ports, and an editable inspector.
6. Keep trace state derived from the active graph; expose trace incompatibility instead of silently replaying unknown nodes.
7. Add graph JSON import/export after the command surface is stable.
8. Verify command tests, UI interaction tests, typecheck, static checks, production build, and unscripted browser authoring.

## Acceptance

- All authoring operations produce a new serializable graph document.
- Removing a node removes its incident edges atomically.
- Invalid typed connections leave the graph unchanged and show the validator's repair message.
- Undo/redo restores exact graph documents and a new edit clears redo history.
- Dragging persists node coordinates in the graph document.
- Configuration changes update node data, not component-local topology state.
- The interface labels authoring and trace modes distinctly.
- Trace replay cannot run after an edit removes a node referenced by the trace.
- Existing replay behavior and tests remain green.

## Deferred Beyond This Increment

The project compiler, live local SDK adapter, task input/resume controls, Apps Host/View preview, templates, and full migration support remain separate increments over the same graph and trace registries.
