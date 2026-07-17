# Task 3A report: authoritative revisioned Effect schema codecs

## Status

Complete on `codex/wp3-authoritative-generation`, stacked on WP2 head `1e6ccc8`.
No remote state was changed. No PR, issue, tag, release, or publish operation was performed.

Implementation commit range before this report: `c5df3a9..79b756f`.

## Commits

- `c5df3a9` Test authoritative MCP schema codec generation
- `ee9ed65` Generate authoritative revisioned Effect codecs
- `4c30d35` Verify generated MCP codec authority
- `e69447a` Update codec freshness verification
- `77b3539` Route facade descriptors through generated codecs
- `79b756f` Gate verification on authoritative codec tests

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

## What changed

- `scripts/generate-mcp.mjs` now reads only `sources/vendor/mcp-core/schema.ts` and `schema.json`, verifies both pinned SHA-256 values, and fails before generation on source drift.
- The former raw copies under `src/generated/mcp/2026-07-28/` were removed so they cannot become a second authority.
- The generator emits one revisioned Effect Schema export per one of the 154 pinned `$defs`, plus sorted `MCP_SCHEMA_DEFINITION_NAMES` and exact `MCP_SCHEMA_CODECS` registries.
- The generated converter covers refs, unions, `anyOf`, `oneOf`, object fields, required/optional fields, arrays, records/additional properties, recursive JSON, literals/enums, primitives, integers, numeric/string/array bounds, and byte transforms.
- Unsupported schema keywords and unsupported recursion fail closed instead of falling back to `Schema.Unknown`.
- The recursive `JSONValue`/`JSONObject` component is emitted explicitly; all other definitions are emitted in dependency order.
- `format: "byte"` fields decode base64 wire strings to `Uint8Array` and encode back to base64.
- `ResultType` remains extensible, concrete result codecs require literal `complete`, `InputRequiredResult` requires literal `input_required`, and `EmptyResult` is emitted as a concrete complete result.
- Object definitions are emitted as `Schema.Class` where retained public construction behavior needs `new`/`.make`; record/index-signature definitions remain record schemas.
- `src/McpSchema.ts` now aliases generated core codecs and routes ergonomic RPC descriptors through generated request/notification/result codecs. SDK services, Effect error wrappers, parameter helpers, and pre-WP7 task placeholders remain handwritten.
- The tool-registration boundary now adds the pinned root `type: "object"` invariant to `JSONSchema.make` output before constructing a generated `Tool`.
- Focused fixtures cover registry parity, recursive JSON, bytes, capabilities, metadata, requests, notifications, all retained stable result classes, discriminators, bounds, enums, and malformed unions.
- Drift tests prove that a changed required array, discriminator, definition, or generated file fails.
- Source-of-truth docs, source-refresh fixture paths, and tier freshness checks now point at the pinned vendor inputs and generated codec format.
- `test:wp3-schema` is part of `pnpm run verify`.

## Design choices

- The pinned TypeScript and JSON artifacts are both read during normal, network-free generation. JSON supplies the exhaustive structural inventory; TypeScript supplies the protocol version, method/result metadata, open `ResultType` intent, and the discriminator/byte reconciliation required by the brief.
- Exact source hashes are checked inside the generator as well as by `sources:check`. A source refresh therefore cannot silently regenerate against an unaudited revision.
- `Schema.Unknown` appears only at upstream fragments that are explicitly unconstrained (`unknown`, arbitrary JSON Schema keyword values, extension/index-signature values). Named core payloads always resolve to generated codecs.
- `allOf` object refinements are structurally merged before emission. This avoids invalid runtime intersections such as `Schema.Int` with a literal error code while retaining the narrowed literal.
- Empty object schemas emit a record schema so they reject non-objects while preserving JSON Schema's open-property default.
- Task definitions were not generated because they are absent from the pinned core `$defs`; the existing quarantined placeholders remain excluded until WP7.

## Verification

Final authoritative runtime: Node `v22.22.3`, pnpm `10.11.1`.

Focused green command:

```text
env PATH=/Users/b.c.nims/.nvm/versions/node/v22.22.3/bin:/opt/homebrew/bin:/usr/bin:/bin CI=true corepack pnpm run test:wp3-schema
```

Result: 6 tests passed, 0 failed, including the four drift mutations.

Minimum gates, all passing:

- `pnpm run sources:check`
- `pnpm run check:generated`
- `pnpm run build`
- `pnpm run check:schema-fixtures` — 20 round-trips and 8 negative cases
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
- Confirmed the active facade no longer duplicates generated core request, notification, result, capability, content, or union fields.
- Confirmed generated byte codecs transform both directions and reject malformed base64.
- Confirmed every concrete core result with `resultType` rejects missing/wrong discriminators, while the intentionally open `ResultType` codec accepts extension values.
- Confirmed unsupported schema constructs throw from generation and no named core payload is replaced with a permissive placeholder.
- Confirmed task and obsolete lifecycle definitions are absent from the generated registry.

## Remaining Task 3B work

- Generate the full message unions, method/result routing registries, HTTP method/name metadata, and associated fixtures from the authoritative inputs.
- Replace the remaining regex-oriented protocol metadata output only within Task 3B's locked scope.
- Do not implement WP4 transport/dispatcher behavior or WP7 task runtime while completing Task 3B.

## Risks and assumptions

- The generator intentionally pins source hashes in code. A future audited source refresh must update those pins and regenerate outputs in the same reviewed change; otherwise generation fails closed.
- `Schema.Unknown` remains at upstream `unknown` and arbitrary JSON Schema/extension-value boundaries. Transport JSON validation remains responsible for excluding non-JSON runtime values before wire encoding.
- The official external conformance artifact remains absent, as reported by the readiness checker; this does not affect the Task 3A full package gate or self-hosted draft e2e result.

## Environment outcomes

- Surprising positive: the pinned `$defs` graph has only one recursive component, allowing deterministic dependency-ordered class emission without weakening the public types.
- Surprising negative: the tier freshness checker still assumed raw copied inputs and unquoted generated fields; it failed after the generator became authoritative even though the codecs were correct.
- Durable positive change made: focused authority/drift tests are now a mandatory part of `pnpm run verify`.
- Durable negative mitigation made: all source-of-truth documentation, refresh fixture paths, and freshness checks now point at `sources/vendor/mcp-core` and the generated codec registry.
