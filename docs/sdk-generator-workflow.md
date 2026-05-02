# Standalone SDK Generator Workflow

This workflow turns the local MCP specification and SEP material into
repeatable work for the standalone `mcp-effect-sdk` package.

## Inputs

Read these sources in this order:

1. `../modelcontextprotocol/schema/2025-11-25/schema.json`
2. `../modelcontextprotocol/schema/2025-11-25/schema.ts`
3. `../modelcontextprotocol/seps/1730-sdks-tiering-system.md`
4. `../modelcontextprotocol/seps/1686-tasks.md`
5. `../modelcontextprotocol/seps/2133-extensions.md`
6. `../conformance/`

The stable schema files define protocol shape. SEP-1730 defines SDK tier
evidence. SEP-1686 defines task behavior that the SDK must expose without
inventing a second execution model. SEP-2133 defines extension opt-in rules.
`../conformance/` supplies behavioral scenarios and future trace validation.

## Operating Model

This workflow is phase-gated. Use
`docs/acceptance-gates/sdk-generator.md` as the acceptance criteria source for
each section of work. Before starting a phase, select the relevant criteria from
that file. Before continuing to the next phase, produce a static acceptance
validation report against those criteria.

Do not continue when a critical criterion is `FAIL`, `AMBIGUOUS`, or materially
`PARTIAL`. Criteria that depend on runtime behavior must name the exact dynamic
commands that will validate them later, but static review must not claim those
commands pass.

### 1. Convert protocol inputs into generated surfaces

Generate every protocol-shaped API that can be derived from stable MCP inputs:

- schema codecs and type aliases from `schema.json`
- method groups, request/result pairings, notifications, and protocol constants
  from `schema.ts`
- client request methods from request metadata
- server handler slots from request metadata
- notification helpers from notification metadata
- fixture metadata from conformance scenarios

Handwritten code is limited to generator code, Effect runtime kernels,
transport adapters, and documented ergonomic helpers over generated facts.

Acceptance gate: `docs/acceptance-gates/sdk-generator.md`, Phases 1-4.

### 2. Build SDK tier evidence from SEP-1730

Treat SEP-1730 as the package readiness scoreboard:

- Tier 3: experimental package with no feature completeness guarantee
- Tier 2: at least 80% conformance coverage, stable release, basic docs,
  dependency update policy, and a roadmap toward Tier 1
- Tier 1: all conformance tests pass, full protocol support, documented stable
  release/versioning, examples for all features, and a dependency update policy

The package should expose a generated evidence report before claiming Tier 2 or
Tier 1. Manual status prose is not enough.

Acceptance gate: `docs/acceptance-gates/sdk-generator.md`, Phase 6.

### 3. Make tasks a first-class generated/runtime boundary

SEP-1686 tasks should be implemented as protocol metadata over existing
requests, not as a separate SDK execution stack.

Required SDK workflow:

- generate task request, result, notification, and metadata types from stable
  MCP inputs
- expose low-level request start/poll/result primitives
- layer ergonomic Effect APIs over those primitives
- keep capability advertisement truthful to implemented runtime behavior
- test task status transitions, related-task metadata, polling, result
  retrieval, cancellation, listing, and deletion behavior

The generator owns protocol shape. Runtime kernels own state transitions and
transport/session behavior.

Acceptance gate: `docs/acceptance-gates/sdk-generator.md`, Phase 5.

### 4. Keep extensions explicit and opt-in

SEP-2133 says SDK extension support is optional. If this SDK supports an
extension:

- it must be disabled by default
- users must opt in explicitly
- docs must list supported extensions
- unsupported peers must get core protocol fallback or a clear rejection path
- extension support must not be counted as core conformance

This matters for the local Effect-oriented SEP drafts: they can motivate
prototypes, but they should not silently expand the core SDK surface.

Acceptance gate: `docs/acceptance-gates/sdk-generator.md`, Phase 7.

### 5. Verify before porting old tests

Run verification in this order:

1. `pnpm run check:sdk-workflow`
2. `pnpm run check:invariants`
3. `pnpm run build`
4. generated parity tests against stable MCP inputs
5. generated round-trip tests for representative messages
6. generated dispatch tests from method metadata
7. conformance example server/client scenarios
8. selected historical tests ported from `mcp/`

Do not wire `mcp/` wholesale into the active test suite. Port behavior only
after generated protocol facts and runtime boundaries exist.

Acceptance gate: `docs/acceptance-gates/sdk-generator.md`, Phase 8.

## Immediate Work Queue

0. For the selected work item, complete Phase 0 in
   `docs/acceptance-gates/sdk-generator.md`.
1. Add a package-local generator entrypoint, then validate Phase 1 before
   continuing.
2. Make regeneration idempotent for `src/generated/mcp/*`, then validate the
   applicable Phase 1/3 criteria before continuing.
3. Generate method metadata rich enough to drive client, server, notification,
   dispatch, and fixture work.
4. Validate Phase 2 before replacing client/server surfaces.
5. Replace handwritten protocol-shaped code with generated output, validating
   Phases 3 and 4 as the work lands.
6. Add SDK tier evidence reporting from conformance and package metadata, then
   validate Phase 6.
7. Add an Everything-style example server for conformance testing, then validate
   Phase 6 again with the example included.
8. Port historical `mcp/` tests only when they validate surviving behavior, then
   validate Phase 8.
