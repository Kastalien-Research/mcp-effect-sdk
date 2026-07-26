# Conformance alpha.9 external contradictions

## Status and authority

The complete official MCP `2026-07-28` client and server inventories remain the
acceptance authority. This document does not turn failures into passes. It
records four failed checks whose expectations contradict the pinned normative
schema or the harness's own embedded dependency boundary.

- Normative schema: `modelcontextprotocol/modelcontextprotocol` revision
  `26897cc322f356487da89113451bd16b520b9288`, vendored under
  `sources/vendor/mcp-core/`.
- Official evaluator: `@modelcontextprotocol/conformance@0.2.0-alpha.9`, source
  revision `ce25103b1baa6e0653e0b7bf4f79de385ea7a116`.
- Evaluator's embedded SDK: `@modelcontextprotocol/sdk@1.29.0`.
- Executable reproducers:
  `node --test test/conformance/alpha9-contradictions.test.mjs`.

## Optional client information promoted to required

Affected checks:

- `sep-2575-request-meta-invalid-missing-client-info`
- `sep-2575-http-server-meta-invalid-400`

The normative `RequestMetaObject` requires
`io.modelcontextprotocol/protocolVersion` and
`io.modelcontextprotocol/clientCapabilities`. It defines
`io.modelcontextprotocol/clientInfo` as optional and says clients SHOULD include
it. Alpha.9 deliberately omits that optional field and expects JSON-RPC `-32602`
plus HTTP 400. A conforming server accepts the request, so one invalid harness
premise produces two failed checks.

Unblock condition: the evaluator must stop treating absent `clientInfo` as
invalid, or the normative schema must change and be explicitly repinned and
reconciled.

## Server information checked outside result metadata

Affected check:

- `sep-2575-server-implements-discover`

The normative `DiscoverResult` has no top-level `serverInfo` property. Server
identity is the optional `result._meta["io.modelcontextprotocol/serverInfo"]`
field inherited through `ResultMetaObject`. Alpha.9 rejects an otherwise
complete discovery result when `result.serverInfo` is absent.

Unblock condition: the evaluator must inspect the reserved `_meta` field and
must not require optional server identity, or the normative schema must change
and be explicitly repinned and reconciled.

## Network-ref scenario cannot reach its claimed behavior

Affected check:

- `sep-2106-no-network-ref-deref`

The `json-schema-ref-no-deref` scenario advertises only MCP `2026-07-28` while
its server transport comes from embedded `@modelcontextprotocol/sdk@1.29.0`.
That SDK's latest and supported-version constants stop at `2025-11-25`. Version
negotiation therefore fails before the SDK under test can call `tools/list`; the
evaluator never reaches the network `$ref` behavior it claims to measure.

Unblock condition: the evaluator must use a server implementation that supports
the advertised protocol version, or advertise a version supported by its
embedded server while keeping the scenario applicable.

## Evidence and gate disposition

The latest complete evidence before these reproducers was captured at SDK commit
`23a9e3b` and produced identical results on Node `22.22.3` and `24.15.0`:

- Server: 40 scenarios, 115 checks, 3 failures, no warnings or skips.
- Client: 32 scenarios, 978 checks, 1 failure, no warnings, 2 upstream-declared
  informational skips.

Artifact paths are recorded in
`docs/internal/prompts/2026-07-21-inventory-controlled-core-handoff.md`. The
official commands remain nonzero. No expected-failure allowlist, protocol
downgrade, duplicate compatibility field, harness-name special case, or version
lie is permitted.

## How the readiness gate consumes this

`docs/conformance/conformance-blockers.json` is the machine-readable form of the
adjudications above, and is what `GR-CONF-001` reads when the conformance
artifact records failures. SEP-1730 requires 100% conformance for Tier 1, so
this is not a waiver: it asserts the SDK is conforming and the evaluator is
wrong, and it is only believed while that assertion stays provable.

`scripts/check-sdk-readiness-requirements.mjs` returns `pass` only when all of
the following hold, and reports the requirement as failing otherwise:

1. The ledger's pinned harness version matches the version that produced the
   artifact. Any harness upgrade re-opens every adjudication.
2. The run recorded no warnings and no skips. The ledger adjudicates failures
   only and cannot be widened to cover anything else.
3. Every failing check ID appears in the ledger. A new failure is never
   absorbed.
4. Every ledger entry is still failing. An adjudication that has been fixed
   upstream must be deleted rather than left to rot.
5. Every entry names a reproducer, and
   `pnpm run test:conformance-contradictions` passes in the same readiness run.

The resulting evidence string names each blocked check and states explicitly
that the run was not clean, so an adjudicated pass can never be mistaken for
one.

Two independent gates protect the ledger itself: `check:conformance-evidence`
validates it against `conformance-blockers.schema.json` and rejects any entry
naming a reproducer test that does not exist, and `verify` runs the reproducers
directly. This is deliberately stricter than the `expected-failures.yml`
allowlist that was removed from this repository — that file is still rejected
outright.
