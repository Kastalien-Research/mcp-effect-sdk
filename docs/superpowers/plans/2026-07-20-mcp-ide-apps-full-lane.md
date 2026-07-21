# MCP IDE and MCP Apps Full Lane Implementation Plan

> **For Codex:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` to implement this plan task-by-task. Use one implementer at a time in the shared worktree, then an independent requirements/quality reviewer before accepting each task.

**Goal:** Deliver the MCP IDE complete first pass—editable low-code graph authoring, truthful fixture and live execution, inspectable Effect project generation, async input flows, and MCP Apps lifecycle/preview—while landing the stable and preview Apps SDK surfaces in their required upstream order.

**Architecture:** The versioned MCP application graph is the single authoring source. A compiler produces a deterministic, inspectable project IR and source files. Fixture replay and live SDK capture both normalize into one versioned, redacted trace document. The browser IDE remains an Effect 3/Bun/Next package; the SDK and any local companion communicate through versioned JSON and never share framework internals. Stable Apps, preview Apps, and core MCP remain explicit, separately qualified contracts.

**Tech stack:** TypeScript, Effect 3, React 19, Next 16 static export, Bun/Vitest/Biome, Node 22, pnpm, Effect MCP SDK public exports, Playwright for the eventual real double-iframe Apps boundary.

## Invariants and dependency gates

- Preserve the collaborator-owned root `package.json` and `pnpm-lock.yaml` changes until they are reconciled through version control.
- Do not bind IDE code to the current SDK's private files or Effect 4 types. The other SDK lane is rebuilding the public package on Effect 3.
- Upstream order is hard: accepted WP7 Tasks, then WP8 stable Apps server/View, then WP9 stable Host and isolated preview.
- Stable and preview Apps both use `io.modelcontextprotocol/ui`; every session carries an explicit profile. Never infer a profile from the extension identifier.
- Stable constants are `text/html;profile=mcp-app` and UI protocol `2026-01-26`.
- MRTR input/resume and Tasks-extension input/resume are different event families even if they share visual language.
- Redact/classify at ingestion, before payloads enter browser state, persistence, export, or logs.
- Unsupported compiler topology must return structured issues and repair choices; it must never be silently approximated.
- Each task is accepted only after focused tests, typecheck/build appropriate to the risk, implementer self-review, and independent review with no unresolved Critical or Important findings.

## Task 1: Add repeatable MCP IDE lane verification

**Files:**

- Create: `visual-effect/scripts/verify-mcp-ide.mts`
- Modify: `visual-effect/package.json`
- Create: `scripts/verify-apps-ide-lanes.mjs`
- Create: `docs/verification/apps-ide-lanes.md`
- Test: `visual-effect/scripts/verify-mcp-ide.test.ts`
- Test: `scripts/check-apps-ide-verifier.mjs`

**Behavior:** A focused IDE verifier runs scoped Biome, typecheck, focused MCP IDE tests, and production build independently, preserving every result in an external artifact directory. A root composite supports `fixture` now and `contract` later, reports absent future Apps contracts as `not-configured`, and never presents fixture proof as SDK or conformance proof.

1. Write failing Vitest coverage for the IDE verifier plus a dependency-free Node check script for composite argument validation, artifact schema, command-result retention after one failure, and `not-configured` contract mode.
2. Implement `verify:mcp-ide -- --artifact-dir <absolute>` without formatter writes or shell `&&` short-circuiting.
3. Emit `mcp-ide.json` plus per-gate stdout/stderr logs with schema version, commit, command, cwd, exit code, duration, required flag, status, and summary counts.
4. Implement the root composite with `--mode fixture|contract`, `--strict-repo`, and optional `--include-conformance`; never inspect secrets to invent an authorization target.
5. Document disposable-worktree operation and the distinction among fixture, local contract, repository hygiene, extension qualification, and official conformance.
6. Run both verifier test programs, the new verifier, and inspect its JSON artifact. Do not modify root `package.json` while the collaborator-owned dependency edit is unreconciled.

## Task 2: Make the graph model compiler-grade

**Files:**

- Modify: `visual-effect/src/mcp-ide/model/McpGraphDocument.ts`
- Create: `visual-effect/src/mcp-ide/model/GraphRegistry.ts`
- Create: `visual-effect/src/mcp-ide/model/GraphFingerprint.ts`
- Modify: `visual-effect/src/mcp-ide/authoring/GraphDocumentIO.ts`
- Modify: `visual-effect/src/mcp-ide/authoring/GraphCommands.ts`
- Modify: `visual-effect/src/mcp-ide/components/AuthoringInspector.tsx`
- Test: `visual-effect/src/mcp-ide/graph.test.ts`
- Test: `visual-effect/src/mcp-ide/graph-commands.test.ts`
- Test: `visual-effect/src/mcp-ide/graph-document-io.test.ts`

**Behavior:** Node configs become a discriminated union from one registry. Graph version 2 adds a deterministic revision/fingerprint. Validation covers per-kind configuration and a complete UI-independent topology, including explicit Apps resource/View/Host relations, while issues include actionable repairs.

1. Write failing table-driven tests for every node config and every allowed/forbidden edge pair.
2. Define typed configs for client, gateway, server, tool, resource, prompt, task, app-resource, app-view, and app-host; keep protocol payloads out of the authoring schema.
3. Centralize kind defaults, runtime decoding, labels, ports, and edge compatibility in `GraphRegistry.ts`; remove duplicate kind arrays.
4. Add `McpGraphIssue.repair` with stable action identifiers and valid alternatives.
5. Add a canonical fingerprint that excludes layout-only positions but includes executable topology/configuration; make revision explicit in the document.
6. Add v1-to-v2 migration and preserve explicit rejection of unknown future versions.
7. Render issues and repair guidance structurally in the inspector.
8. Run graph/command/I/O tests, typecheck, scoped Biome, and production build.

## Task 3: Version, redact, import, and export graph/trace bundles

**Files:**

- Modify: `visual-effect/src/mcp-ide/model/McpTraceDocument.ts`
- Create: `visual-effect/src/mcp-ide/model/TraceRegistry.ts`
- Create: `visual-effect/src/mcp-ide/trace/TraceRedaction.ts`
- Create: `visual-effect/src/mcp-ide/authoring/TraceDocumentIO.ts`
- Create: `visual-effect/src/mcp-ide/authoring/McpProjectBundleIO.ts`
- Modify: `visual-effect/src/mcp-ide/components/DocumentInspector.tsx`
- Test: `visual-effect/src/mcp-ide/trace-document-io.test.ts`
- Test: `visual-effect/src/mcp-ide/project-bundle-io.test.ts`
- Test: `visual-effect/src/mcp-ide/trace-redaction.test.ts`

**Behavior:** Trace version 2 binds to graph revision, carries explicit correlation/span/edge identity, separates structured protocol/runtime data from a redacted payload, and round-trips with its graph as a portable bundle.

1. Write failing tests for stale graph rejection, trace migration, deterministic round trips, secret/header redaction, and unsupported-version errors.
2. Define the trace event registry and distinct event families for wire messages, runtime lifecycle, MRTR, Tasks, and Apps.
3. Implement allowlist-first redaction for authorization/cookie headers and explicit sensitive-value markers.
4. Add trace and graph+trace bundle codecs/migrations with redaction provenance.
5. Add import/copy/download controls and compatibility diagnostics without making raw secret-bearing export possible.
6. Run focused I/O/redaction tests, all MCP IDE tests, typecheck, scoped Biome, and build.

## Task 4: Complete deterministic replay controls and inspection

**Files:**

- Modify: `visual-effect/src/mcp-ide/trace/TraceReplay.ts`
- Modify: `visual-effect/src/mcp-ide/components/ExecutionTimeline.tsx`
- Modify: `visual-effect/src/mcp-ide/components/InspectorPanel.tsx`
- Modify: `visual-effect/src/mcp-ide/McpIdeApp.tsx`
- Modify: `visual-effect/src/mcp-ide/trace-replay.test.ts`
- Modify: `visual-effect/src/mcp-ide/McpIdeApp.test.tsx`

**Behavior:** Replay is a validated race-safe state machine with run, pause, resume, step, seek, cancel, and reset. Selecting any timeline item can seek to it. Inspection exposes request/result pairing, wire metadata, spans, fibers/scopes/causes, Apps profile/policy, and edge traversal when present.

1. Write failing state-machine tests for pause during sleep, resume without replaying, exactly-one step, forward/backward seek, cancel from paused/running, terminal invariants, and stale generation rejection.
2. Validate graph revision in the controller constructor/factory rather than only in React.
3. Implement the controller transitions and derive snapshots from event prefix for deterministic seek.
4. Add accessible controls and timeline seeking; retain fixture/live disclosure.
5. Split the inspector into structured sections and keep sanitized JSON as a secondary view.
6. Run focused replay/UI tests, all IDE tests, typecheck, scoped Biome, and build.

## Task 5: Add beginner/pro templates and fixture-first Apps projection

**Files:**

- Create: `visual-effect/src/mcp-ide/templates/TemplateRegistry.ts`
- Create: `visual-effect/src/mcp-ide/templates/beginnerTool.ts`
- Create: `visual-effect/src/mcp-ide/templates/proGatewayTasksApps.ts`
- Create: `fixtures/mcp-apps/v1/stable-view-lifecycle.json`
- Create: `fixtures/mcp-apps/v1/preview-host-lifecycle.json`
- Create: `visual-effect/src/mcp-ide/apps/AppsTraceAdapter.ts`
- Create: `visual-effect/src/mcp-ide/apps/AppLifecyclePanel.tsx`
- Create: `visual-effect/src/mcp-ide/apps/AppPreviewPlaceholder.tsx`
- Modify: `visual-effect/src/mcp-ide/McpIdeApp.tsx`
- Test: `visual-effect/src/mcp-ide/templates/templates.test.ts`
- Test: `visual-effect/src/mcp-ide/apps/apps-fixtures.test.ts`

**Behavior:** Users can start from a small beginner server or a professional gateway/vertical/Tasks/Apps application. Sanitized stable and preview Apps fixtures use explicit profiles, lifecycle, linkage, consent/policy outcomes, and provenance. The preview surface remains visibly fixture-only and disabled until WP9.

1. Write failing template registry and Apps fixture contract tests, including profile non-inference and rejected policy cases.
2. Implement versioned template metadata and deterministic graph/trace bundles.
3. Implement a public-event-to-normalized-trace adapter interface with a test fake, no private SDK imports.
4. Add template selection, Apps timeline/filter, lifecycle/resource linkage panel, explicit profile marker, and disabled preview disclosure.
5. Add both fixtures to Task 1 artifact hashing.
6. Run fixture/template/UI tests, the focused verifier, and browser QA at desktop and narrow widths.

## Task 6: Compile graphs into inspectable Effect MCP projects

**Files:**

- Create: `visual-effect/src/mcp-ide/compiler/McpProject.ts`
- Create: `visual-effect/src/mcp-ide/compiler/compileGraph.ts`
- Create: `visual-effect/src/mcp-ide/compiler/renderProject.ts`
- Create: `visual-effect/src/mcp-ide/compiler/CompilerBackend.ts`
- Create: `visual-effect/src/mcp-ide/components/ProjectInspector.tsx`
- Modify: `visual-effect/src/mcp-ide/McpIdeApp.tsx`
- Create: `visual-effect/src/mcp-ide/compiler/compiler.test.ts`
- Create after upstream reconciliation: `test/ide-generated-project/`

**Behavior:** The graph compiles first to a serializable IR and then deterministic visible source files. The current backend supports the public vertical-server subset and returns repairs for unsupported gateway/runtime semantics. A later backend adapter targets the reconciled SDK without changing graph documents.

1. Write golden tests for beginner and professional IR, deterministic output, unsupported topology, and absence of timestamps/secrets.
2. Define a backend-neutral IR for transports, servers, capabilities, handlers, routing declarations, Tasks/Apps declarations, and required environment inputs.
3. Compile only semantics represented by typed graph config; surface unsupported gateway execution rather than merging servers.
4. Render source, manifest, README/run instructions, and tests; show every byte in the project inspector before download.
5. After the upstream public SDK is accepted, add a clean packed-consumer fixture that imports public exports only and typechecks generated projects.
6. Run compiler goldens, all IDE tests, typecheck, build, and the consumer typecheck when available.

## Task 7: Add a safe local runner and one live SDK path

**Prerequisites:** Reconcile onto the other lane's accepted Effect 3 SDK public server/client surface. Detailed Task capture waits for accepted WP7.

**Files:**

- Create on reconciled SDK base: `src/McpInstrumentation.ts`
- Modify on reconciled SDK base: `src/McpClientProtocol.ts`, `src/McpClient.ts`, `src/McpServer.ts`, `src/index.ts`
- Create: `packages/mcp-ide-runner/`
- Create: `visual-effect/src/mcp-ide/live/RunnerClient.ts`
- Create: `visual-effect/src/mcp-ide/trace/SdkTraceAdapter.ts`
- Test: SDK instrumentation tests, runner tests, adapter parity tests, local E2E

**Behavior:** A loopback-only Node companion executes a generated local application through public SDK APIs and streams the same normalized redacted trace schema used by fixtures. It has explicit origin/session policy, refuses non-loopback targets by default, and propagates cancellation.

1. Add default-no-op typed observer tests at client/server dispatch, handler, MRTR, Task, scope, and failure boundaries.
2. Implement observer hooks without changing behavior when absent.
3. Build the runner protocol with version handshake, graph revision, explicit origin allowlist/session nonce, bounded messages, and ingestion-time redaction.
4. Add fixture/live adapter parity tests and prove auth/cookie/marked values never enter UI state or artifacts.
5. Add live-mode disclosure/control to the IDE and one local vertical tool call E2E.
6. Run SDK verify, runner tests, IDE tests/build, and unscripted local browser execution.

## Task 8: Separate MRTR controls from the Tasks extension

**Prerequisite:** WP7 Tasks accepted and reconciled for live Tasks; fixture MRTR work may begin earlier.

**Files:**

- Modify: `visual-effect/src/mcp-ide/model/McpTraceDocument.ts`
- Create: `visual-effect/src/mcp-ide/tasks/MrtrControls.tsx`
- Create: `visual-effect/src/mcp-ide/tasks/TaskControls.tsx`
- Create: `visual-effect/src/mcp-ide/scenarios/inputRequiredScenario.ts`
- Test: `visual-effect/src/mcp-ide/tasks/*.test.tsx`
- Test: live runner MRTR/Tasks integration suites

**Behavior:** MRTR input-required/supplied/resumed retries the original request with keyed responses and request state. Tasks advertise an opt-in extension and use their own statuses/input lifecycle. Shared styling never collapses their protocol meaning.

1. Write failing fixture tests proving event-family separation and MRTR request-state preservation.
2. Implement fixture controls and resume projection.
3. Bind Tasks only through WP7's named public extension/fixed-result helper.
4. Add live MRTR and Tasks E2E, including cancellation and no task-handle exposure to stable Apps.
5. Run extension checks, SDK verify, IDE tests/build, and local browser E2E.

## Task 9: Implement WP8 stable Apps server and View SDK

**Prerequisite:** The other lane's WP7 is accepted. Start this package from that accepted SDK tip, not from the current IDE branch.

**Files:**

- Create: `src/extensions/apps/index.ts`
- Create: `src/extensions/apps/server.ts`
- Create: `src/extensions/apps/view.ts`
- Create: `src/extensions/apps/PostMessageTransport.ts`
- Modify: `package.json` export map
- Modify: `docs/extensions.md`
- Modify: `scripts/check-extension-boundary.mjs`
- Create: focused stable Apps schema/server/View/interop tests and vanilla browser example

**Behavior:** Intentional browser-safe subpaths expose constants/types, typed capability adapter, `registerAppTool`, `registerAppResource`, `getUiCapability`, visibility/link validation, scoped View lifecycle, and validated postMessage transport. Root/Node imports do not pull DOM globals.

1. Write failing constant/capability/profile isolation tests.
2. Write failing resource/tool tests for `ui://`, exact MIME, HTML, CSP, permissions/domain, nested `_meta.ui.resourceUri`, metadata precedence, same-server visibility, existence, and meaningful text fallback.
3. Write failing View tests for initialize/initialized order, stable methods, event-source/schema validation, pre-init rejection, concurrent isolation, teardown acknowledgement, and cleanup.
4. Implement stable modules and public subpath exports outside generated core files.
5. Add bidirectional pinned `ext-apps@1.7.4` interop and separate extension evidence.
6. Run extension boundary, package export consumers, browser-safe typechecks, interop, and full SDK verify.

## Task 10: Implement WP9 stable Host and isolated preview SDK

**Prerequisite:** WP8 accepted with stable interop evidence.

**Files:**

- Create: `src/extensions/apps/host.ts`
- Create: `src/extensions/apps/SandboxProxy.ts`
- Create: `src/experimental/apps-preview/{index,server,view,host}.ts`
- Create: Playwright double-iframe fixtures/config/tests
- Modify: package export map, extension docs/checks/evidence

**Behavior:** The stable scoped Host bridge implements ordered partial/full tool input, exactly one result or cancellation, context, consent/authorization/audit, acknowledged teardown, and the official two-origin double iframe. Preview additions live in separate codecs/subpaths and cannot leak into stable sessions.

1. Write browser tests for distinct origins, deny-by-default CSP, sandbox attributes, mapped permissions, explicit proxy target origin, source/origin rejection, size bounds, unsafe links/downloads, and teardown cleanup.
2. Write Host lifecycle/policy tests for ordering, exactly-one terminal outcome, consent denial/approval, auditing, and cleanup.
3. Write stable/preview cross-rejection and preview instance/server scope, attribution, confirmation, bounds, and atomic tool removal tests.
4. Implement the Host/security layer, then preview modules without modifying stable codecs.
5. Test Apps+Tasks fixed-result composition and ensure stable postMessage exposes no task handles.
6. Run Playwright at the real double-iframe boundary, extension qualification, packed browser consumer, and full SDK verify.

## Task 11: Integrate accepted Apps SDK contracts into the IDE

**Prerequisites:** WP8 for lifecycle/live View integration; WP9 for runnable Host preview.

**Files:**

- Modify: `visual-effect/src/mcp-ide/apps/AppsTraceAdapter.ts`
- Create: `visual-effect/src/mcp-ide/apps/AppPreviewHost.tsx`
- Modify: `visual-effect/src/mcp-ide/apps/AppLifecyclePanel.tsx`
- Modify: `visual-effect/src/mcp-ide/compiler/*`
- Modify: `visual-effect/src/mcp-ide/live/*`
- Test: Apps adapter parity, policy UI, compiler, and browser integration tests

**Behavior:** The adapter consumes only accepted public versioned Apps events. The IDE shows live lifecycle/profile/policy/resource linkage through the common trace model and enables the sandboxed preview only when Host capability and policy are satisfied.

1. Replace the test fake binding with a public-subpath adapter and preserve fixture/live parity.
2. Teach compiler backends to emit explicit stable/preview declarations and required Host policy without exposing SDK internals in graph JSON.
3. Enable preview in a distinct-origin sandbox; display origin, integrity, consent, permissions, and profile state.
4. Fail closed on malformed messages, wrong source/origin, integrity mismatch, absent consent, unsafe action, or unsupported profile.
5. Run IDE verifier, SDK extension verification, and full browser journeys for stable resource/View and preview Host.

## Task 12: Establish CI ownership and complete-first-pass evidence

**Files:**

- Modify: `.github/workflows/verify.yml`
- Modify: `visual-effect/README.md`
- Modify: root `README.md` and extension/architecture docs as behavior requires
- Create: `docs/verification/mcp-ide-complete-first-pass.md`
- Create: machine-readable acceptance evidence under external `.local`/artifact directories only

**Behavior:** CI pins Bun and runs the focused IDE verifier separately from root SDK verification. Documentation states setup, authoring, compile, fixture/live execution, Tasks/MRTR differences, Apps profiles/security, artifact semantics, and known qualification boundaries. Evidence maps every complete-first-pass criterion to a test/build/browser artifact.

1. Add the isolated IDE CI job without adding UI dependencies to the pnpm root workspace.
2. Resolve or explicitly retain legacy Visual Effect gallery routes and their whole-app formatting baseline.
3. Run Node 22 root verify, extension verification, focused/full IDE tests, typecheck, scoped/full Biome, Next build, generated consumer, local runner E2E, and Apps Playwright suites.
4. Perform unscripted desktop/narrow browser QA for authoring, repairs, imports/exports, templates, compile preview, replay controls, live disclosure, MRTR/Tasks, Apps lifecycle, and sandbox failures.
5. Dispatch independent final requirements, code quality, security, and browser-design reviews; fix every Critical/Important finding and re-review.
6. Record what is product-complete versus what remains external official-conformance or release evidence. Only then mark the full goal complete.

## Baseline evidence captured before implementation

- Node `22.22.3`, pnpm `10.11.1`: root `pnpm run verify` exited 0 when loopback binding was permitted.
- Existing IDE checkpoint: 37 tests, typecheck, scoped Biome, build, and responsive browser QA were previously green; the independent audit classifies it as 1 pass, 6 partial, and 1 fail against the eight complete-first-pass criteria.
- Full Visual Effect `bun run verify` currently stops at an unrelated imported example formatting diff in `src/examples/effect-firstsuccessof.tsx`; focused verification must report this honestly rather than hide or auto-fix it.
- Upstream dependency observation at plan time: WP1-WP5 accepted locally; WP6F sealed and awaiting review; WP7/WP8/WP9 not yet accepted. Refresh this ledger before every dependency-gated task.
