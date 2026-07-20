---
date: 2026-07-20
topic: mcp-ide
---

# Effect MCP IDE

## What We're Building

Build a light, Effect-native IDE for authoring, running, and understanding MCP applications. The IDE should make MCP topology and execution legible to beginners without flattening the protocol or Effect runtime into misleading boxes and arrows. It should also give professional users a fast way to design gateways and vertical servers, exercise client/server interactions, inspect wire data, and reason about asynchronous Tasks and MCP Apps.

The product has two coupled loops over one versioned application graph. In the authoring loop, users compose typed MCP components and configure them through focused forms or raw JSON. In the execution loop, the IDE runs or replays that graph and projects protocol messages, Effect lifecycle events, and outputs back onto the exact authored nodes and connections. The first runnable checkpoint is trace-first, but editable graph authoring is the product and the shared graph document is its foundation.

## Why This Approach

Three approaches were considered. A standalone trace viewer is fast but becomes a disposable demo. A builder-first canvas proves the headline interaction but risks inventing abstractions before the runtime can explain them. The chosen approach starts with a shared, typed graph document and delivers its execution projection first. That creates a useful checkpoint while ensuring every trace event, inspector view, and visual primitive also serves the authoring system.

The interface should feel like a protocol instrument panel: compact, exact, animated where motion explains causality, and quiet where users need to read payloads. It should build on Visual Effect's Effect-first state transitions, interruption, timing, and motion without inheriting its example-gallery information architecture.

## Key Decisions

- **One graph, two projections:** authoring and execution share stable node and edge IDs; traces never invent a second topology.
- **MCP concepts before raw Effect combinators:** primary nodes represent clients, gateways, servers, capabilities, tools, resources, prompts, Tasks, and Apps. Effect fibers, scopes, streams, schedules, and causes appear as runtime detail and advanced authoring primitives.
- **Typed edges:** transport, routing, exposure, invocation, task/result, and UI-resource relationships validate differently and render distinctly.
- **Versioned and serializable:** the graph document is data, not React state. It supports validation, migration, diffing, import/export, fixtures, and eventual code generation.
- **Event adapters at the boundary:** deterministic fixtures, replay files, SDK instrumentation, and live transports all emit the same normalized trace event model.
- **Truthful visual states:** idle, active, waiting, input-required, completed, failed, cancelled, and interrupted remain distinct. Animation reflects observed events rather than optimistic UI guesses.
- **Protocol and runtime inspection:** users can move from a high-level topology to JSON-RPC envelopes, headers, metadata, timings, Effect causes, scopes, and fiber relationships without leaving the run.
- **Framework isolation:** the IDE is a separate application. React, Next.js, Motion, and browser dependencies do not enter the SDK's production dependency graph.
- **MCP Apps is both subject and delivery surface:** the IDE will inspect Apps lifecycle traffic, host sandboxed Views, and eventually be deliverable as a View where the host permits it. Stable and preview profiles remain explicit and isolated.
- **Safe by default:** graph documents and trace exports exclude secrets, live connections are explicit, potentially unsafe App actions remain policy/consent gated, and payload views support redaction.

## Complete First Pass

A complete first pass is not merely a runnable animation. It includes:

1. A palette and editable canvas for adding, positioning, configuring, connecting, duplicating, and removing typed MCP nodes.
2. Immediate structural and protocol-aware validation with clear repair guidance.
3. A compiler/export path that produces an inspectable Effect MCP project representation from the graph without hiding generated code.
4. Simulated/replayed runs plus at least one live local SDK execution path, all using the same trace model.
5. Run, pause where supported, cancel, reset, step/replay, selection, timeline, and payload/runtime inspection.
6. First-class gateway routing, vertical server composition, and asynchronous Task states including input-required and resume.
7. MCP Apps resource linkage and lifecycle visualization, followed by a sandboxed Host/View preview when the SDK surface lands.
8. Import/export of versioned graph and trace documents with representative beginner and professional templates.

Cloud deployment, collaborative editing, hosted persistence, marketplace distribution, and universal code round-tripping are later product phases.

## First Runnable Checkpoint

The checkpoint proves the substrate with a deterministic client → gateway → vertical server → tool → Task → result scenario. It renders the authored topology, replays causally linked events, exposes a timeline and exact payload inspector, and supports run, cancel, and reset. Its fixture is loaded through the same graph and trace contracts that future authoring and live SDK adapters will use.

The checkpoint is accepted only if the graph document is validated independently of the UI, trace replay is deterministic under a test clock, node states are derived from events, and no root SDK production dependency is added.

## Open Questions

- Which project artifacts should the first compiler backend own once the post-migration SDK API is stable: a declarative module, full source files, or both?
- Should live execution run through a local companion process, a browser-safe transport, or both?
- Which advanced Effect concepts deserve editable nodes versus inspector-only representation after user testing?
- What is the eventual product name? `MCP IDE` remains the working name.

## Next Steps

Implement the trace-first checkpoint against the shared graph document, then begin editable canvas operations without replacing that model.
