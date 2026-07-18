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
5. `13664eb` — `docs: record task 3b verification evidence`
6. `e914b9f` — `test: define protocol review regressions`
7. `60ba3b5` — `test: require result category location evidence`
8. `1d5c866` — `fix: harden authoritative protocol generation`
9. `dbd821b` — `docs: record task 3b review fix evidence`
10. `9ddf696` — `test: define final protocol review regressions`
11. `7616d5e` — `fix: validate protocol authority surfaces`

Commits 6–8 are the first independent-review fix cycle. Commits 10–11 are the
second cycle; this report and the ignored recovery-ledger/review-diff updates
are its evidence checkpoint.

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

Initial focused result under Node `v22.22.3`: 7/7 pass. The first test also creates
an obsolete unrevisioned output in a fixture and proves `--check` rejects it.

The first independent review then identified five Important fail-closed and
identity gaps. Production remained unchanged through commits `e914b9f` and
`60ba3b5`. The RED run had 12 tests: the original 7 passed and exactly the 5 new
review regressions failed for their intended reasons:

- flattened single-member JSON groups compared only method and params ref, not
  the complete codec-relevant shape;
- same-direction request/notification method or type metadata could collide;
- an HTTP name-source leaf could be trusted beneath a non-object params schema;
- duplicate, conflicting, or malformed method-like result `@category` metadata
  was not rejected with declaration location evidence; and
- optional effective payload wrappers were constructed independently in the
  by-type and by-method registries instead of sharing one canonical identity.

Final focused result under Node `v22.22.3`: 12/12 pass. The positive controls
also preserve a structurally identical optional single-member alias and the
intentional cross-direction reuse of `notifications/cancelled`.

The second independent review identified one remaining Important group-parity
gap and one Minor export-surface gap. Production remained unchanged through
commit `9ddf696`. The exact Node `v22.22.3` RED run had 14 tests: the existing 12
passed and exactly 2 new tests failed for their intended reasons:

- a multi-member protocol group branch containing both a valid `$ref` and the
  codec-affecting sibling `type: number` generated successfully; its
  description-only positive control passed; and
- removing `export` from `ClientRequest`, active `DiscoverRequest`, or consumed
  `ListToolsResult` still generated successfully.

Final focused result under Node `v22.22.3`: 14/14 pass.

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

The independent-review fix makes the optionality-aware by-type registry the
single construction site for each effective payload codec. By-method registries,
named facades, and group facades now reference that exact object identity. The
raw params registry continues to point directly to the exact named `Generated`
codec.

Generation now compares every flattened single-member group against its
concrete definition after recursively canonicalizing object keys and required
array order while excluding non-codec descriptions. It rejects method or type
collisions between requests and notifications within each direction, but does
not reject intentional cross-direction reuse.

HTTP name-source validation now requires the parent params definition to be an
object with a properties object before validating the required primitive string
leaf. Result pairing structurally collects every `@category` tag: taxonomy-only
base/helper categories remain valid, while method-like metadata must be exactly
one exact backticked method literal. Failures name the interface and pinned
source line; the existing duplicate result-method mapping check remains in
force.

The second review fix requires every multi-member protocol group branch to be
an exact existing definition `$ref` plus, at most, a string `description`.
Codec-affecting or unknown siblings fail before schema lowering with the group,
branch index, and member name. This check is intentionally local to protocol
group membership: ordinary `$ref` sibling support elsewhere in schema lowering
remains unchanged, as does TypeScript-owned normative order and JSON set parity.

AST modifier checks now require top-level `export` only for declarations
actually consumed as Task 3B protocol authority: group aliases, active message
interfaces, and active result interfaces. Errors include the declaration and
pinned source line. Internal/helper schema declarations that are not consumed
by these surfaces remain valid. The production change is generator-only; the
generated artifacts remain byte-identical.

## Verification

All passing commands below used:

```bash
env PATH=/Users/b.c.nims/.nvm/versions/node/v22.22.3/bin:/opt/homebrew/bin:/usr/bin:/bin CI=true corepack pnpm ...
```

- `pnpm run test:wp3-protocol` — pass, 14/14.
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
- Escalated `pnpm run verify` — second review-fix rerun pass at commit `7616d5e`,
  exit 0. Self-hosted `draft-round-trip` and `tools-call` both passed.

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

## Review disposition and self-review

- The first independent review found five Important issues; all five have a
  committed RED regression and a passing implementation described above.
- The second independent review found one Important and one Minor issue; both
  have a committed RED regression and a passing implementation described above.
- Post-second-fix self-review found no remaining Critical, Important, or Minor
  issue in the review-fix diff.
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
is the focused identity/parity suite, which now proves identity through the
by-type, by-method, named, and grouped surfaces on every refresh.

Negative: adding the TypeScript dev dependency at generator startup exposed that
Task 3A mutation fixtures linked `node_modules` only after generation. The
durable fix moves the existing symlink into fixture creation, so every direct
and mutation invocation begins in a production-like dependency environment.

The review cycle's surprising negative was that individually correct request
and notification registries could still be ambiguous when combined by
direction. The targeted disjointness invariant makes that integration boundary
fail closed during generation instead of relying on downstream map behavior.

The second cycle's surprising positive was that the export contract could be
enforced narrowly with existing AST declarations and no generated-output churn.
The surprising negative was that the general schema lowerer correctly supports
`$ref` siblings, while protocol group membership needs a deliberately stricter
local contract. The dedicated group-branch test preserves both behaviors.

The obsolete-output behavior test and operational refresh/check documentation
are the additional environment changes: future refreshes cannot silently
reintroduce the unrevisioned artifact or leave operators guessing which command
owns it.

## Remaining risks and boundaries

- Result pairing depends on the pinned structural `@category` method contract.
  Taxonomy-only base/helper categories are intentionally ignored; method-like
  metadata is strict. Unsupported future method-tag syntax fails closed and
  requires an explicit generator/test update.
- Protocol group branches intentionally permit only `$ref` and string
  `description`; future non-codec annotations require an explicit whitelist and
  positive regression before acceptance.
- The Tier freshness check intentionally projects enriched descriptors onto its
  historical fields; `test:wp3-protocol` is the authoritative enriched parity
  gate.
- Task extensions remain quarantined for WP7.
- JSON-RPC dispatch, ID preservation, wire errors, HTTP/SSE enforcement,
  cancellation, and retries remain WP4+ work and were not changed here.
- MCP Tier/release readiness remains blocked by the separately reported
  conformance, release-provenance, published-documentation, and agent-evaluation
  evidence gates even though repository health passes.
- Task 3B still requires coordinator-owned final read-only review and a full
  Node 22 rerun at the exact proposed head before acceptance.
