# Task 3 report: versioned, redacted graph and trace bundles

## Summary

Implemented trace schema v2 as the portable execution projection of graph schema v2. Every trace
now binds to both graph ID and executable graph revision, and its normalized event envelope can
carry edge, correlation, span, and parent-span identity. One registry owns the wire, runtime, MRTR,
Tasks, and Apps family/channel contract plus replay node-state derivation; MRTR and Tasks remain
separate normalized families.

Trace ingestion and serialization now pass through deterministic allowlist-first redaction.
Authorization, cookie, set-cookie, and non-allowlisted header values are removed; well-known secret
keys and explicit `$mcpSensitive` values are recursively replaced before a decoded document is
returned. Redaction paths and reasons are retained as sorted provenance. Defensive serialization
re-sanitizes and reconstructs only contract fields, so type-cast extra fields cannot become an
export bypass.

Added trace and graph-plus-optional-trace bundle codecs. Bundle decoding validates the graph first
and then the trace against that exact graph. Legacy v1 traces require the explicit
`allowLegacyRebind` option and record source graph, target graph, and target revision in migration
provenance. The IDE document inspector now selects graph, trace, or bundle; imports accepted trace
state into replay; shows revision compatibility; and copies/downloads only accepted sanitized
state. Graph-only imports retain the current trace without silently rebinding it.

## Files

- `visual-effect/src/mcp-ide/model/McpTraceDocument.ts`
- `visual-effect/src/mcp-ide/model/TraceRegistry.ts`
- `visual-effect/src/mcp-ide/trace/TraceRedaction.ts`
- `visual-effect/src/mcp-ide/trace/TraceReplay.ts`
- `visual-effect/src/mcp-ide/authoring/TraceDocumentIO.ts`
- `visual-effect/src/mcp-ide/authoring/McpProjectBundleIO.ts`
- `visual-effect/src/mcp-ide/components/DocumentInspector.tsx`
- `visual-effect/src/mcp-ide/McpIdeApp.tsx`
- `visual-effect/src/mcp-ide/scenarios/gatewayTaskScenario.ts`
- `visual-effect/src/mcp-ide/trace-document-io.test.ts`
- `visual-effect/src/mcp-ide/project-bundle-io.test.ts`
- `visual-effect/src/mcp-ide/trace-redaction.test.ts`
- `visual-effect/src/mcp-ide/trace-replay.test.ts`
- `visual-effect/src/mcp-ide/McpIdeApp.test.tsx`
- `visual-effect/app/globals.css`

The pre-existing root `package.json` and `pnpm-lock.yaml` changes were neither edited nor staged.
No root SDK source, plan, `.gitignore`, Task 1 verifier, compiler, live runner, Tasks control, Apps
preview, or Visual Effect gallery file was changed.

## TDD evidence

- RED: the initial three focused suites failed at the three missing Task 3 module boundaries before
  production code existed.
- RED: after the module seams existed, the focused I/O/redaction slice had 3 intended behavioral
  failures out of 12 tests: explicit-marker precedence and canonical trace/bundle round trips.
- GREEN: the same slice passed 12/12 after marker-first traversal and canonical portable JSON.
- RED: the existing replay slice had 2 intended v2 failures out of 6 because the old kind switch no
  longer derived node state.
- GREEN: replay passed 6/6 after state derivation moved into the trace registry.
- RED: the UI slice had 2 intended failures out of 10 because trace/bundle selectors did not exist.
- GREEN: UI passed 10/10 after document modes, sanitized imports/exports, compatibility diagnostics,
  and state-backed replay were implemented.
- RED (security self-review): a focused redaction witness retained a marked secret in type-cast
  non-contract document/event fields.
- GREEN (security self-review): the witness passed after defensive contract reconstruction; the
  full redaction slice passed 4/4.

## Verification

- `CI=1 bun run test --run src/mcp-ide/trace-document-io.test.ts src/mcp-ide/project-bundle-io.test.ts src/mcp-ide/trace-redaction.test.ts` — passed, 3 files / 12 tests.
- `CI=1 bun run test --run src/mcp-ide/trace-replay.test.ts` — passed, 1 file / 7 tests after adding registry-coherence and edge-reference coverage.
- `CI=1 bun run test --run src/mcp-ide/McpIdeApp.test.tsx` — passed, 1 file / 10 tests with no React warnings.
- `CI=1 bun run test --run src/mcp-ide` — passed, 8 files / 86 tests.
- `bun run typecheck` — passed.
- `bunx biome check src/mcp-ide app/globals.css` — passed, 29 files, no fixes applied.
- `bun run verify:mcp-ide -- --artifact-dir /private/tmp/mcp-ide-task3-accepted` — passed
  outside the restricted sandbox, 4 required gates passed / 0 failed, including production build.
- `git diff --check` — passed before commit.

The first verifier run retained three passing gates and one build failure caused only by the
restricted sandbox denying Turbopack's local helper process/port. The accepted run used the required
capability once and passed. Both builds rewrote punctuation in tracked `visual-effect/next-env.d.ts`;
the generated change was restored and is not part of Task 3.

Not run: root `pnpm run verify`, whole-app Visual Effect `bun run verify`, official conformance, or
browser QA. They are outside this bounded trace/bundle task. The accepted Task 1 verifier includes
the scoped IDE build and full MCP IDE test lane.

## Artifact

- Accepted pre-commit artifact: `/private/tmp/mcp-ide-task3-accepted/mcp-ide.json`
- A post-commit accepted verifier run will be stored at
  `/private/tmp/mcp-ide-task3-final/mcp-ide.json` so its `commit` field matches the atomic Task 3
  commit.

## Commit

- One atomic Task 3 commit contains this report and the scoped implementation. Its final hash is
  returned in the coordinator handoff; a Git commit cannot embed its own hash without changing it.

## Risks and assumptions

- Graph revision remains the accepted deterministic FNV-1a compatibility identity from Task 2, not
  a cryptographic integrity hash.
- Redaction is deterministic key/header/marker classification, not general content DLP. Payload
  producers must explicitly mark sensitive values whose field names are not well-known. Only
  `accept`, `content-type`, and `mcp-protocol-version` header values are retained.
- Legacy v1 has no graph revision. Its opt-in migration uses the supplied validated graph and records
  the rebind; it cannot prove the legacy events originally came from that executable revision.
- The registry defines normalized trace semantics only. It does not claim MCP wire methods, live SDK
  execution, Tasks controls, or Apps Host/View lifecycle behavior.
- The browser editor can transiently contain user-pasted source before import, but copy/download
  never uses that buffer. Decoded application trace state is returned only after redaction and exact
  graph compatibility validation.

## Self-review

- Confirmed native v2 requires graph ID and revision and rejects unknown event node/edge IDs plus
  kind/family/channel incoherence.
- Confirmed layout/display-only graph changes remain compatible through the accepted Task 2
  fingerprint, while executable edge/config changes reject the trace as stale.
- Confirmed v1 import fails even for the same graph ID unless explicit rebind is enabled, and that
  successful rebind provenance survives deterministic serialization.
- Confirmed raw authorization/cookie/custom-header values, recursive secret fields, explicit
  sensitive markers, and type-cast extra fields are absent from sanitized state and exports.
- Confirmed serializers re-sanitize defensively and copy/download use accepted serialized state,
  never the editable import buffer.
- Confirmed bundle decode validates its embedded graph before decoding its optional trace and never
  validates against ambient IDE graph state.
- Confirmed the fixture, replay, timeline, and event count all consume trace v2; no stale v1 switch
  remains outside the explicit migration codec.
- Confirmed the scoped commit excludes the collaborator-owned root manifest/lockfile changes and all
  forbidden implementation lanes.

## Environment compounding

- Surprising positive: the accepted graph revision seam made strict trace compatibility and
  graph-first bundle validation small and auditable instead of requiring a second identity system.
- Surprising negative: defensive redaction by recursive payload traversal alone still allowed
  type-cast non-contract fields to survive object spreading.
- Positive-targeted change made: replay state metadata now comes from the trace registry, so future
  normalized event kinds cannot silently miss a separate replay switch.
- Negative-targeted change made: a regression test now requires sanitizer output to reconstruct only
  contract fields and proves marked raw values cannot survive extra document/event properties.
- Environment recommendation: teach the focused verifier to guard and restore generated
  `next-env.d.ts` punctuation churn after build while still reporting it in the artifact.
