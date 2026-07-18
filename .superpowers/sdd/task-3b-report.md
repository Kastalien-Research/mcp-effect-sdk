# Task 3B report: authoritative revisioned protocol metadata

## Scope and branch state

- Branch: `codex/wp3-authoritative-generation`
- Worktree: `/private/tmp/mcp-effect-sdk-wp3`
- Accepted starting head: `ab841181ff99ef8a4e8d65c6ccee8b7e50f25559`
- Stacked dependency preserved: unmerged WP2 head `1e6ccc8`
- Scope: Task 3B only. No WP4 dispatcher/transport work, WP5+ feature work,
  task-extension implementation, remote mutation, merge, release, or Tier claim.

## Commits

1. `cf3b784` — `test: define authoritative protocol metadata contract`
2. `405feae` — `feat: generate authoritative revisioned protocol metadata`
3. `32d257b` — `fix: project enriched descriptors in tier freshness check`
4. `f9cd193` — `test: reject obsolete protocol generation output`

This report and the final ignored recovery-ledger update are the evidence-only
handoff checkpoint after those behavioral commits.

## TDD evidence

The committed RED checkpoint ran before production changes. The local default
runtime was Node `v25.6.1`; the coordinator accepted that RED evidence and all
implementation verification then used the required Node `v22.22.3` runtime.

RED result: 7 tests, 0 pass, 7 expected failures.

- The revisioned protocol artifact did not exist and the obsolete path remained.
- Descriptors omitted params type/optionality, direction, and HTTP metadata.
- Descriptor, envelope, params, result, and message codec registries were absent.
- Active group and JSON-RPC boundary codecs were absent.
- HTTP `Mcp-Method` / `Mcp-Name` source metadata was absent.
- `McpSchema` still used a handwritten active-core RPC table and fallback codec.
- A repinned JSON membership disagreement generated successfully instead of
  failing closed; the same suite covered method, params, result, duplicate, and
  HTTP-name-source mutations once implementation began.

Final focused result under Node `v22.22.3`: 7/7 pass. The first test also creates
an obsolete unrevisioned output in a fixture and proves `--check` rejects it.

## Implementation and source reconciliation

`scripts/generate-mcp.mjs` now parses protocol metadata with the TypeScript
compiler API already present as a development dependency. It fails on parse
diagnostics, missing/duplicate declarations, unsupported type-alias or heritage
syntax, duplicate group members/methods, nonliteral methods, unnamed params,
missing result metadata, and all tested TypeScript/JSON disagreements.

Reconciliation rules are explicit:

- TypeScript `ClientRequest`, single-member `ClientNotification`, optional or
  absent `ServerRequest`, and `ServerNotification` aliases own generated order.
- JSON Schema independently confirms membership (as a set because its union
  order differs), literal methods, params references, and params requiredness.
- Result interfaces are structurally paired by literal `@category` method; the
  JSON result definition and any concrete result-response reference are checked.
- The pinned draft has no `ServerRequest`; generated descriptors and registries
  are empty and no `SERVER_REQUEST_CODEC` is invented.
- Removed lifecycle and task methods remain absent from active generated groups.

The protocol output moved to
`src/generated/mcp/2026-07-28/McpProtocol.generated.ts`; the obsolete
unrevisioned artifact was removed. All source imports, checks, fixtures,
manifest entries, and operational documentation were migrated.

Generated request descriptors contain type, literal method, named params type,
params optionality, result type, direction, and HTTP metadata. Notifications
contain the same fields except result type. Generated lookups cover type and
method projections for descriptors, methods, params types, result types,
envelopes, raw named params codecs, optionality-aware payload codecs, and result
codecs. Boundary exports re-export exact revisioned `ClientRequest`,
`ClientNotification`, `ServerNotification`, and JSON-RPC request, notification,
result response, error response, response, and message codecs.

HTTP metadata gives every active method its exact method-header value. Only
`tools/call` and `prompts/get` use `params.name`; only `resources/read` uses
`params.uri`; all others explicitly use `null`. Generation verifies each named
path is required and a primitive string, with URI format required for `uri`.

`McpSchema` now constructs active RPC groups from generated payload/result
registries. Named exports are thin type-name aliases. The handwritten active
method/params/result table, impossible fallback schema, and second group table
were removed. Optional notification params deliberately use generated
optionality-aware payload wrappers while raw params registries remain identical
to the named generated codec exports.

## Verification

All passing commands below used:

```bash
env PATH=/Users/b.c.nims/.nvm/versions/node/v22.22.3/bin:/opt/homebrew/bin:/usr/bin:/bin CI=true corepack pnpm ...
```

- `pnpm run test:wp3-protocol` — pass, 7/7.
- `pnpm run sources:check` — pass, 6 pinned sources.
- `pnpm run check:generated` — pass; both generated artifacts byte-current.
- `pnpm run build` — pass.
- `pnpm run test:wp3-schema` — pass, 28/28.
- `pnpm run check:schema-fixtures` — pass, 23 round-trips and 9 negatives.
- `pnpm run check:type-fixtures` — pass.
- `pnpm run test:wp2-review` — pass, 16/16.
- `pnpm run test:unit` — pass.
- `pnpm run test:integration` — pass.
- `pnpm run check:generated-protocol-surfaces` — pass.
- `pnpm run check:invariants` — pass, 0 accepted violations.
- `pnpm run check:sdk-workflow` — pass.
- Escalated `pnpm run verify` — final rerun pass, exit 0. Self-hosted
  `draft-round-trip` and `tools-call` both passed.

The first full verify exposed one compatibility defect: the Tier freshness check
compared enriched descriptors to its older exact object shape. Commit `32d257b`
projects the generated descriptors onto the legacy fields that check owns;
structural completeness remains owned by the Task 3B parity suite. The final
full rerun passed.

An additional non-gating `pnpm run check:ts-sdk-parity` attempt failed because
the external TypeScript SDK and conformance reference files are unavailable in
this worktree. The repository's verify workflow intentionally does not include
that unavailable-reference check; this did not affect package-local Task 3B
verification.

## Self-review

- No Critical, Important, or Minor issue found in the Task 3B diff.
- Generated order matches TypeScript authority, while JSON membership is still
  independently checked.
- Exact codec identity is tested; no active registry uses `Schema.Unknown`.
- Optional params distinguish raw named codecs from effective payload codecs.
- No task or removed lifecycle method entered active groups.
- No active-core handwritten method/result/params fallback table remains.
- Generation remains deterministic and network-free.

## Surprising outcomes and environment compounding

Positive: the exact revisioned schema exports made the runtime registries simple
identity-preserving maps instead of requiring adapter codecs. The durable change
is the focused identity/parity suite, which protects that property on refresh.

Negative: adding the TypeScript dev dependency at generator startup exposed that
Task 3A mutation fixtures linked `node_modules` only after generation. The
durable fix moves the existing symlink into fixture creation, so every direct
and mutation invocation begins in a production-like dependency environment.

The obsolete-output behavior test and operational refresh/check documentation
are the additional environment changes: future refreshes cannot silently
reintroduce the unrevisioned artifact or leave operators guessing which command
owns it.

## Remaining risks and boundaries

- Result pairing depends on the pinned structural `@category` method contract;
  unsupported future source syntax fails closed and requires an explicit
  generator/test update.
- The Tier freshness check intentionally projects enriched descriptors onto its
  historical fields; `test:wp3-protocol` is the authoritative enriched parity
  gate.
- Task extensions remain quarantined for WP7.
- JSON-RPC dispatch, ID preservation, wire errors, HTTP/SSE enforcement,
  cancellation, and retries remain WP4+ work and were not changed here.
- MCP Tier/release readiness remains blocked by the separately reported
  conformance, release-provenance, published-documentation, and agent-evaluation
  evidence gates even though repository health passes.
- Task 3B still requires independent read-only review and a coordinator-owned
  full Node 22 rerun at the exact proposed head before acceptance.
