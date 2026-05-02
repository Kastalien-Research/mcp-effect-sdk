# SDK Generator Acceptance Gates

Use these gates when executing `docs/sdk-generator-workflow.md`.

Each phase starts with explicit acceptance criteria and ends with a static
acceptance validation report. Do not continue to the next phase when a critical
criterion is `FAIL`, `AMBIGUOUS`, or materially `PARTIAL`.

The report must use the Acceptance Criteria Validator format:

- overall verdict
- criteria-by-criteria verdict table
- evidence for each verdict
- missing or weak evidence
- static-analysis limitations
- recommended dynamic validation commands
- overall readiness verdict

Static validation is not a substitute for dynamic validation. It is the gate
that decides whether the implementation is ready to spend runtime/test effort
on the next phase.

## Phase Status

| Phase | Title                                              | Status      |
| ----- | -------------------------------------------------- | ----------- |
| 0     | Workflow Grounding                                 | Complete    |
| 1     | Package-Local Generator Entrypoint                 | Complete    |
| 2     | Generated Protocol Metadata                        | Complete    |
| 3     | Generated Schema Surface                           | Complete    |
| 4     | Generated Client, Server, Notifications, Dispatch  | Complete    |
| 5     | Task Runtime Boundary                              | Complete    |
| 6     | Conformance Evidence And Example Server            | Not started |
| 7     | Extension Opt-In Gates                             | Not started |
| 8     | Historical Test Reconciliation                     | Not started |

Status reflects merged-to-main work. Per-phase static acceptance reports are
not retained in-tree; the executable gate is `pnpm run verify`, which runs the
checks under `scripts/check-*.mjs`.

## Phase 0: Workflow Grounding

Purpose: prove the next work item has concrete criteria before implementation.

Acceptance criteria:

- AC-0.1: The work item names exactly one SDK generator phase.
- AC-0.2: The work item cites the source files/specs it derives requirements
  from.
- AC-0.3: The work item lists generated outputs, handwritten outputs, tests,
  and docs that are expected to change.
- AC-0.4: The work item identifies criteria that cannot be statically validated
  and names the dynamic commands that will validate them later.

Required evidence:

- task prompt, issue, spec, or local work plan with atomic acceptance criteria
- source paths under `../modelcontextprotocol`, `../conformance`, or this package
- explicit out-of-scope list when adjacent tracks exist in `effect-smol` or SEP
  drafts

Exit rule: continue only when all criteria are `PASS`.

## Phase 1: Package-Local Generator Entrypoint

Purpose: create the package-owned generator path without relying on ad hoc
repair scripts or the upstream `effect-smol` workflow.

Acceptance criteria:

- AC-1.1: `mcp-effect-sdk` has a package-local generator entrypoint under
  `scripts/`.
- AC-1.2: The generator reads stable MCP `2025-11-25` inputs from checked-in or
  explicitly referenced local files.
- AC-1.3: The generator does not fetch network resources.
- AC-1.4: The generator does not import or execute historical `mcp/` code.
- AC-1.5: Package scripts expose regeneration and verification commands.
- AC-1.6: Generated files include deterministic generated-file banners.

Required evidence:

- `package.json`
- `scripts/*`
- `src/generated/mcp/*`
- `scripts/check-invariants.mjs`

Exit rule: continue when critical criteria pass and dynamic validation commands
are named for idempotency and build checks.

## Phase 2: Generated Protocol Metadata

Purpose: generate method and protocol facts rich enough to drive public SDK
surfaces.

Acceptance criteria:

- AC-2.1: Generated metadata includes latest stable protocol version.
- AC-2.2: Generated metadata includes client request methods.
- AC-2.3: Generated metadata includes server request methods.
- AC-2.4: Generated metadata includes client notification methods.
- AC-2.5: Generated metadata includes server notification methods.
- AC-2.6: Generated metadata includes request/result pairings where stable MCP
  inputs define them.
- AC-2.7: Generated metadata includes task methods and notifications from the
  stable task surface.
- AC-2.8: Tests or static checks compare generated metadata to stable inputs.

Required evidence:

- `src/generated/mcp/McpProtocol.generated.ts`
- generator source under `scripts/`
- parity tests or static checks
- stable schema inputs under `src/generated/mcp/2025-11-25/`

Exit rule: do not replace handwritten client/server surfaces until this phase
has no critical `FAIL` verdicts.

## Phase 3: Generated Schema Surface

Purpose: make `McpSchema` a generated-backed facade instead of a handwritten
protocol model.

Acceptance criteria:

- AC-3.1: Generated schema exports cover stable MCP `$defs`.
- AC-3.2: Public schema/types are exported through a stable facade.
- AC-3.3: Handwritten `McpSchema` code is limited to Effect convenience helpers
  and runtime-neutral facade behavior.
- AC-3.4: Public APIs avoid `any` except documented raw JSON boundaries.
- AC-3.5: Representative round-trip tests or static fixtures cover generated
  schema decoding/encoding.

Required evidence:

- `src/generated/mcp/McpSchema.generated.ts`
- `src/McpSchema.ts`
- `src/index.ts`
- schema round-trip tests or generated fixture checks
- invariant check output from a separate dynamic validation workflow

Exit rule: continue only when generated coverage is sufficient for the next
client/server replacement phase.

## Phase 4: Generated Client, Server, Notifications, And Dispatch

Purpose: replace protocol-shaped handwritten surfaces with generated API
layers over small runtime kernels.

Acceptance criteria:

- AC-4.1: Client request methods are generated or visibly generated-backed.
- AC-4.2: Server handler registration slots are generated or visibly
  generated-backed.
- AC-4.3: Notification helpers are generated or visibly generated-backed.
- AC-4.4: Dispatch routes through generated method/schema metadata.
- AC-4.5: Runtime kernels remain handwritten and scoped to send, receive,
  dispatch, encode, decode, transport, and session lifecycle.
- AC-4.6: Capability advertisement is gated by implemented runtime behavior,
  not by schema existence alone.

Required evidence:

- `src/McpClient.ts`
- `src/McpServer.ts`
- `src/McpNotifications.ts`
- `src/McpSerialization.ts`
- generated protocol metadata
- dispatch/client/server tests

Exit rule: do not claim protocol feature completion while generated metadata and
runtime capability gates disagree.

## Phase 5: Task Runtime Boundary

Purpose: implement SEP-1686 tasks as metadata over existing requests, not as a
parallel SDK execution stack.

Acceptance criteria:

- AC-5.1: Task request/result/notification shapes come from generated stable MCP
  inputs.
- AC-5.2: Low-level request start/poll/result primitives exist.
- AC-5.3: Ergonomic Effect APIs are layered over low-level primitives.
- AC-5.4: Task status transition rules are enforced by runtime code.
- AC-5.5: Related-task metadata is attached to task-associated requests,
  notifications, and responses.
- AC-5.6: Cancellation, result retrieval, listing, deletion, and keep-alive
  behavior have tests or explicit unsupported-behavior gates.
- AC-5.7: Non-task-supporting peers fall back to core protocol behavior where
  SEP-1686 requires it.

Required evidence:

- generated task schemas and metadata
- task runtime modules
- task behavior tests
- capability negotiation tests

Exit rule: treat runtime behavior as `NOT_STATICALLY_DETERMINABLE` unless tests
or state-machine code make enforcement visible.

## Phase 6: Conformance Evidence And Example Server

Purpose: turn SEP-1730 SDK tier requirements into package evidence.

Acceptance criteria:

- AC-6.1: The package includes an Everything-style example server for
  conformance testing.
- AC-6.2: Conformance scenarios are mapped to SDK features.
- AC-6.3: The package exposes a generated or reproducible SDK tier evidence
  report.
- AC-6.4: Tier 2 and Tier 1 claims are backed by conformance results, docs,
  release/versioning policy, and dependency update policy.
- AC-6.5: The README does not claim a tier that is not evidenced.

Required evidence:

- example server source
- conformance scenario mapping
- evidence report
- README/package metadata
- docs for examples, versioning, and dependency updates

Exit rule: do not publish tier claims based on roadmap intent.

## Phase 7: Extension Opt-In Gates

Purpose: keep Effect-oriented SEP prototypes separate from core SDK
conformance.

Acceptance criteria:

- AC-7.1: Extension support is disabled by default.
- AC-7.2: Users opt in explicitly to each extension.
- AC-7.3: Supported extensions are documented.
- AC-7.4: Unsupported peers receive core protocol fallback or clear rejection.
- AC-7.5: Extension support is not counted as core protocol conformance.
- AC-7.6: Experimental extension code is isolated from generated core protocol
  code.

Required evidence:

- extension registration/configuration code
- docs listing supported extensions
- tests for fallback or rejection behavior
- conformance evidence that excludes extension-only behavior

Exit rule: do not merge extension work into the core generator path without a
separate acceptance validation report.

## Phase 8: Historical Test Reconciliation

Purpose: port only surviving behavior from `mcp/` after generated surfaces and
runtime kernels are established.

Acceptance criteria:

- AC-8.1: Each ported historical test maps to a current public API or runtime
  kernel.
- AC-8.2: Tests for deleted or replaced behavior are not ported.
- AC-8.3: `mcp/` is not imported by active `src/` code or active tests.
- AC-8.4: Historical ad hoc scripts remain quarantined or are replaced by real
  package scripts.
- AC-8.5: The acceptance validation report identifies behavior intentionally
  dropped during reconciliation.

Required evidence:

- historical `mcp/` tests
- active tests
- import checks
- package scripts
- reconciliation notes

Exit rule: delete or archive `mcp/` only after the report shows the surviving
behavior has active coverage.

## Gate Discipline

For every phase:

1. Write or select the acceptance criteria before implementation.
2. Implement only that phase.
3. Produce a static acceptance validation report against the phase criteria.
4. Run dynamic validation commands only after static validation says the phase is
   ready for them.
5. Record any dynamic-only criteria as follow-up evidence, not static `PASS`.
6. Continue to the next phase only after critical criteria pass or are explicitly
   deferred in the roadmap.
