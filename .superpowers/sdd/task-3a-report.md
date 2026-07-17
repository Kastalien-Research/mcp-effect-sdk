# Task 3A report: authoritative revisioned Effect schema codecs

## Status

Complete on `codex/wp3-authoritative-generation`, stacked on WP2 head `1e6ccc8`.
All independent review findings are resolved and the branch is ready for re-review.
No remote state was changed. No PR, issue, tag, release, or publish operation was performed.

Implementation commit range before this report update: `c5df3a9..a6bc5b9`.

## Commits

- `c5df3a9` Test authoritative MCP schema codec generation
- `ee9ed65` Generate authoritative revisioned Effect codecs
- `4c30d35` Verify generated MCP codec authority
- `e69447a` Update codec freshness verification
- `77b3539` Route facade descriptors through generated codecs
- `79b756f` Gate verification on authoritative codec tests
- `e9908f7` Document Task 3A codec generation evidence
- `2232c26` Test Task 3A review findings
- `512597e` Fix authoritative schema codec review gaps
- `c2feea7` Document Task 3A review fix evidence
- `1bd4600` Correct generated artifact documentation
- `1c9cdff` Test inherited and exact schema semantics
- `d6d6916` Test exact codec encode semantics
- `6b299a9` Test result construction preserves extensions
- `3ef4e4a` Generate exact inherited schema semantics
- `72e5c10` Document exact schema semantics evidence
- `b196c05` Test aggregate aliases and exact intersections
- `a6bc5b9` Generate exact aggregate and intersection codecs

## Review history

- The first independent review identified six generator, codec, facade, and fixture findings; committed RED tests and fixes are recorded in `2232c26..512597e`.
- A final documentation review found that the README's `src/generated/mcp/*.generated.ts` shorthand did not include the revisioned schema module. The README now names the root protocol artifact and revisioned schema artifact separately.
- The existing `check:sdk-workflow` gate already asserts both exact artifact paths, so no new wording-specific documentation test was added.
- The third independent review identified missing MRTR continuation validation, lost inherited Result extensions, incomplete allOf validation, and unimplemented exact oneOf/closed-object semantics. Commits `1c9cdff`, `d6d6916`, and `6b299a9` record the RED contracts; `3ef4e4a` implements them.
- The fourth independent review identified permissive `ClientResult`/`ServerResult` aggregates, closed public constructor inputs for otherwise open Result descendants, lossy duplicate allOf constraints, and dropped `$ref` siblings. Commit `b196c05` records the RED contracts; `a6bc5b9` implements them.

## Red evidence

The first production change was preceded by committed tests in `c5df3a9`.

Command:

```text
env CI=true corepack pnpm run test:wp3-schema
```

Result against the WP2 generated/manual split, before production changes:

```text
tests 5
pass 0
fail 5
```

The five expected failures proved that:

- generation still read duplicate raw files under `src/generated/mcp/2026-07-28`;
- the generated registry did not exactly match the pinned `$defs` names and did not contain codecs;
- recursive JSON and base64 byte codecs were absent;
- generated discriminator, enum, bounds, and union behavior was absent;
- retained object schemas were not generated as constructible Effect classes.

The independent review fixes were also implemented red-first in committed test
checkpoint `2232c26`.

Command:

```text
env PATH=/Users/b.c.nims/.nvm/versions/node/v22.22.3/bin:/opt/homebrew/bin:/usr/bin:/bin CI=true corepack pnpm run test:wp3-schema
```

Result before the review fixes:

```text
tests 11
pass 5
fail 6
```

Those failures reproduced the unrevisioned physical output, non-finite number
acceptance, lost `EmptyResult` extension fields and description, absent stable
base-result coverage, permissive roots/list payload facade, and converter
acceptance of exact `oneOf` and closed-object semantics it did not implement.

The third review cycle began with committed tests in `1c9cdff` and `d6d6916`.

```text
tests 14
pass 9
fail 5
```

The failures reproduced the missing InputRequiredResult at-least-one rule,
extension loss across the transitive Result family, skipped allOf-member
validation, rejected rather than generated oneOf, and rejected rather than
generated closed objects. The oneOf and closed-object fixtures exercise both
decode and encode semantics after re-pinning the copied source hash.

An additional public-construction RED checkpoint in `6b299a9` produced 13
passes and one failure, proving that an interim implementation still stripped
extensions through `new` and `.make`. The final implementation uses only the
public `Schema.Class`/`Schema.Struct`/`Schema.Record` APIs and passes that
contract.

The fourth review cycle began with committed aggregate, intersection, and
strict construction tests in `b196c05`.

```text
WP3 schema tests: 17 total, 14 pass, 3 fail
strict type fixtures: 2 TS2353 failures
```

The focused failures proved that no pinned TypeScript named-alias registry was
generated, `ClientResult` admitted `input_required`, `$ref` siblings and
duplicate allOf constraints were discarded, and direct extension literals
were rejected by a Result constructor and `.make`. The final intersection
fixture additionally covers disjoint fields and a forced unsupported
`Schema.extend` overlap with unique fields plus a base64 transformation.

## What changed

- `scripts/generate-mcp.mjs` now reads only `sources/vendor/mcp-core/schema.ts` and `schema.json`, verifies both pinned SHA-256 values, and fails before generation on source drift.
- The former raw schema copies under `src/generated/mcp/2026-07-28/` were removed so they cannot become a second authority; the generated Effect module now lives at `src/generated/mcp/2026-07-28/McpSchema.generated.ts`.
- The generator emits one revisioned Effect Schema export per one of the 154 pinned `$defs`, plus sorted `MCP_SCHEMA_DEFINITION_NAMES` and exact `MCP_SCHEMA_CODECS` registries.
- The generated converter covers refs, `anyOf` unions, exact `oneOf`, object fields, required/optional fields, open and closed additional-property semantics, arrays, recursive JSON, literals/enums, finite numbers, integers, numeric/string/array bounds, and byte transforms.
- Exact `oneOf` uses an encoded-input single-match guard before union conversion; overlapping inputs fail while exactly one matching branch round-trips. `additionalProperties: false` emits a closed Struct with excess-property errors on decode and encode.
- Every allOf member is recursively validated and emitted as an exact intersection. The generated helper uses public `Schema.extend` where Effect supports the overlap and a public bidirectional `Schema.transform` fallback that decodes/encodes both members, merges unique object fields, preserves the left prototype, and retains transformations.
- `$ref` siblings are emitted as intersections instead of allowing the reference or its siblings to win by branch order; numeric/string/array bounds remain layered onto the resulting codec.
- Unsupported schema keywords and unsupported recursion fail closed instead of falling back to `Schema.Unknown`.
- The recursive `JSONValue`/`JSONObject` component is emitted explicitly; all other definitions are emitted in dependency order.
- `format: "byte"` fields decode base64 wire strings to `Uint8Array` and encode back to base64.
- `ResultType` remains extensible, concrete result codecs require literal `complete`, `InputRequiredResult` requires literal `input_required`, and `EmptyResult` is derived from `Result` so it preserves open extension fields and the source description while narrowing `resultType` to `complete`.
- The generator parses the pinned TypeScript interface inheritance graph and treats every transitive `Result` descendant as open. Their Class inputs are backed by real `Schema.Struct(fields, Schema.Record(...))` codecs; explicit generated constructors expose that open schema type to both `new` and inherited `.make`. All 13 descendant classes preserve extension fields through decode, encode, `new`, and `.make`, and expose `readonly [key: string]: unknown` in their public instance type.
- Representable named TypeScript aliases are parsed from the pinned source, added to codec dependency ordering, emitted as exact alias codecs, and recorded in `MCP_SCHEMA_NAMED_ALIAS_MEMBERS`. This narrows `ClientResult` to `EmptyResult` and makes `ServerResult` exactly the pinned complete-result family plus valid `InputRequiredResult`.
- The normative InputRequiredResult JSDoc sentence is parsed into an at-least-one refinement, so `inputRequests` or `requestState` is required without hand-copying those field names into the codec shape.
- Object definitions are emitted as `Schema.Class` where retained public construction behavior needs `new`/`.make`; record/index-signature definitions remain record schemas.
- `src/McpSchema.ts` now aliases generated core codecs and routes ergonomic RPC descriptors through generated request/notification/result codecs. SDK services, Effect error wrappers, parameter helpers, and pre-WP7 task placeholders remain handwritten.
- The tool-registration boundary now adds the pinned root `type: "object"` invariant to `JSONSchema.make` output before constructing a generated `Tool`.
- The roots/list facade uses a generated source-derived optional params codec instead of `Schema.Void`, accepting absent or valid `_meta` params and rejecting malformed payloads.
- Focused fixtures cover registry parity, recursive JSON, bytes, capabilities, metadata, requests, notifications, every transitive Result descendant and its extension behavior, all retained stable result classes, discriminators, bounds, enums, malformed unions, exact oneOf, and closed objects.
- Drift tests prove that a changed required array, discriminator, definition, or generated file fails.
- Source-of-truth docs, source-refresh fixture paths, and tier freshness checks now point at the pinned vendor inputs and generated codec format.
- `test:wp3-schema` is part of `pnpm run verify`.

## Design choices

- The pinned TypeScript and JSON artifacts are both read during normal, network-free generation. JSON supplies the exhaustive structural inventory; TypeScript supplies the protocol version, method/result metadata, open `ResultType` intent, and the discriminator/byte reconciliation required by the brief.
- Exact source hashes are checked inside the generator as well as by `sources:check`. A source refresh therefore cannot silently regenerate against an unaudited revision.
- `Schema.Unknown` appears only at upstream fragments that are explicitly unconstrained (`unknown`, arbitrary JSON Schema keyword values, extension/index-signature values). Named core payloads always resolve to generated codecs.
- `allOf` and `$ref` siblings are lowered to an exact intersection helper. It validates encoded and decoded values against every member, uses `Schema.extend` when supported, and otherwise merges both decoded/encoded representations rather than selecting one member. The fallback is exercised with Effect's unsupported `Schema.Int`/literal overlap, unique fields on both sides, and a base64 transform.
- Empty object schemas emit a record schema so they reject non-objects while preserving JSON Schema's open-property default.
- Result-derived classes remain idiomatic `Schema.Class` values. A real open Struct/Record supplies extension behavior, a refined form supplies the source-derived at-least-one rule where needed, and a generated constructor exposes the open input type without AST mutation or internal Effect APIs.
- Exact oneOf matching is evaluated on the encoded input before union conversion and is applied in reverse during encoding, preserving the codec's bidirectional contract.
- Task definitions were not generated because they are absent from the pinned core `$defs`; the existing quarantined placeholders remain excluded until WP7.

## Verification

Final authoritative runtime: Node `v22.22.3`, pnpm `10.11.1`.

Focused green command:

```text
env PATH=/Users/b.c.nims/.nvm/versions/node/v22.22.3/bin:/opt/homebrew/bin:/usr/bin:/bin CI=true corepack pnpm run test:wp3-schema
```

Result: 17 tests passed, 0 failed, including source-derived named-alias parity,
direct aggregate boundaries, systematic Result inheritance/construction,
four drift mutations, exact allOf and `$ref` sibling behavior, unique-field and
transform preservation, exact `oneOf`, and `additionalProperties: false`.

Minimum gates, all passing:

- `pnpm run sources:check`
- `pnpm run check:generated`
- `pnpm run build`
- `pnpm run check:schema-fixtures` — 23 round-trips and 9 negative cases
- `pnpm run check:type-fixtures`
- `pnpm run test:wp2-review` — 16 passed, 0 failed
- `pnpm run test:unit`
- `pnpm run test:integration`

Final full command:

```text
env PATH=/Users/b.c.nims/.nvm/versions/node/v22.22.3/bin:/opt/homebrew/bin:/usr/bin:/bin CI=true corepack pnpm run verify
```

Result: exit 0. The e2e portion required running outside the filesystem/network sandbox so its ephemeral server could bind `127.0.0.1`; both `draft-round-trip` and `tools-call` passed with exit 0.

Final static checks:

```text
git diff --check 1e6ccc8..HEAD
git status --short --branch
```

Result before adding this report: no whitespace errors and a clean branch.

The historical/external `pnpm run conformance:run` qualification harness was not run; it is not draft-authoritative and is outside Task 3A's minimum gate. The self-hosted draft e2e included by `verify` passed.

## Self-review

- Confirmed the generated name and codec registries equal the sorted pinned `$defs` keys at runtime.
- Confirmed no raw duplicate schema inputs remain under `src/generated`.
- Confirmed the physical schema module, imports, fixture manifests, freshness checks, and documentation that enumerates generated artifacts name the `2026-07-28` schema path; the obsolete unrevisioned module is absent. The root protocol artifact remains explicitly assigned to Task 3B.
- Confirmed the active facade no longer duplicates generated core request, notification, result, capability, content, or union fields.
- Confirmed generated byte codecs transform both directions and reject malformed base64.
- Confirmed every concrete core result with `resultType` rejects missing/wrong discriminators, while the intentionally open `ResultType` codec accepts extension values.
- Confirmed `InputRequiredResult` rejects `input_required` without either continuation field and remains constructible with valid input.
- Confirmed every transitive Result interface descendant preserves extensions through decode, encode, `new`, and `.make`, with a generated public string index signature.
- Confirmed `EmptyResult` preserves extension fields and its exact source description through decode/encode.
- Confirmed generated general-number and recursive JSON codecs reject `NaN` and both infinities.
- Confirmed roots/list accepts absent or source-valid params and rejects invalid scalar or malformed `_meta` payloads.
- Confirmed unsupported schema constructs throw from generation and no named core payload is replaced with a permissive placeholder.
- Confirmed nested allOf members are validated before intersection; duplicate bounds, impossible intersections, `$ref` siblings, disjoint fields, overlapping unique fields, and transformed values preserve exact bidirectional semantics. Exact oneOf rejects overlapping matches and closed objects reject excess keys in both codec directions.
- Confirmed generated named aliases match every representable pinned TypeScript alias, `ClientResult` rejects MRTR/vendor extension discriminators, and `ServerResult` accepts only valid pinned complete or MRTR members.
- Confirmed task and obsolete lifecycle definitions are absent from the generated registry.

## Remaining Task 3B work

- Generate the full message unions, method/result routing registries, HTTP method/name metadata, and associated fixtures from the authoritative inputs.
- Decide and implement the physical revision path for `McpProtocol.generated.ts` within Task 3B; Task 3A moves only the schema codec artifact it owns.
- Replace the remaining regex-oriented protocol metadata output only within Task 3B's locked scope.
- Do not implement WP4 transport/dispatcher behavior or WP7 task runtime while completing Task 3B.

## Risks and assumptions

- The generator intentionally pins source hashes in code. A future audited source refresh must update those pins and regenerate outputs in the same reviewed change; otherwise generation fails closed.
- The pinned source currently contains neither exact `oneOf` constructs nor `additionalProperties: false`; repinned mutation fixtures provide the executable contract for both generated semantics.
- Effect 3.22 cannot `Schema.extend` every valid JSON Schema intersection (notably `Schema.Int` with an integer literal). The generated public-combinator fallback is therefore part of the supported path and is protected by bidirectional unique-field, closed-object, impossible-intersection, and transformation fixtures.
- `Schema.Unknown` remains at upstream `unknown` and arbitrary JSON Schema/extension-value boundaries. Transport JSON validation remains responsible for excluding non-JSON runtime values before wire encoding.
- The official external conformance artifact remains absent, as reported by the readiness checker; this does not affect the Task 3A full package gate or self-hosted draft e2e result.

## Environment outcomes

- Surprising positive: a real open Struct/Record can remain the runtime Class schema while an explicit generated constructor preserves precise known fields and accepts extension literals through both `new` and inherited `.make`.
- Surprising negative: Effect 3.22 throws for some valid structural intersections such as `Schema.Int` with an integer literal, and successful extension can otherwise obscure closed-object encode validation if each member is not checked explicitly.
- Durable positive change made: the generator now derives the complete open Result family, MRTR at-least-one rule, and all representable named aliases from pinned TypeScript rather than result-name, field-name, or aggregate-member lists.
- Durable negative mitigation made: exact bidirectional intersection fixtures cover bounds, impossible refs, closed objects, disjoint/overlapping unique fields, and transformations, while systematic construction fixtures protect open runtime and public input behavior.
