# Task 4D report: stateless Streamable HTTP and legacy transport removal

## Current outcome

Task 4D1, the HTTP metadata and value kernel, is implemented on
`codex/wp4-wire-kernel-transports`. Task 4D2-4D4 have not started.

- Added exact plain/base64-sentinel value encoding with strict canonical
  base64 and fatal UTF-8 decoding that preserves an initial U+FEFF value.
- Added generated-descriptor-backed standard request metadata for
  `MCP-Protocol-Version`, `Mcp-Method`, and the three generated `Mcp-Name`
  sources.
- Added pure `x-mcp-header` planning for statically reachable property chains,
  including nested objects, case-insensitive tchar uniqueness, primitive type
  restrictions, accessor-safe whole-schema traversal, and fail-closed
  composition/conditional/ref/array paths.
- Added typed client extraction and server validation for string, boolean, and
  safe-integer values. Integer comparison is exact across decimal/exponent
  representations and never depends on floating-point rounding.
- Added an HTTP-only catalog filter that retains ordered valid tools and empty
  plans, excludes invalid definitions, emits exactly one constant-safe
  structured warning per exclusion, and preserves warning-sink failures in the
  Effect error channel. Stdio behavior is unchanged.
- Vendored the exact pinned Streamable HTTP page from MCP core commit
  `26897cc322f356487da89113451bd16b520b9288`; manifest SHA-256 is
  `dd6a6255abab9207007d3aca525e5ee235fd6f66a22c240698831b3cc61d9034`.

No remote state was mutated. The first independent review found two Important
issues; both are fixed and Task 4D1 now requires independent rereview and
coordinator acceptance before Task 4D2.

## Public API decisions

- The kernel lives at `src/transport/HttpMetadata.ts`, the intended modern
  HTTP transport boundary rather than the package root.
- `standardRequestHeaders` and `validateStandardRequestHeaders` use generated
  request descriptors and return typed `HeaderMismatchError` failures.
- `analyzeToolHeaders` returns an immutable `HttpToolHeaderPlan` or
  `InvalidToolHeaderDefinition` with only tool name and a constant reason.
- `extractToolHeaders` and `validateToolHeaders` share the same plan and exact
  property paths.
- `filterHttpTools` returns an immutable ordered tool array and frozen,
  null-prototype exact-name plan record. Its configurable Effect warning sink
  retains its error and requirements channels.

## TDD evidence

- Value/standard metadata RED: `471b1f8`; GREEN: `cb9a29f`.
- Custom schema/extraction/validation RED: `34c1f27`; accessor-safety RED:
  `c40aef7`; GREEN: `9574689`.
- Exact integer comparison RED: `2cb728f`; GREEN: `f117fb6`.
- HTTP catalog filtering RED: `279ab6e`; GREEN: `c0f3ab1`.
- Exact pinned specification snapshot: `b744a7a`.
- First-review BOM/array-accessor RED: `0e8ad78`; GREEN: `5328bbf`.

The focused REDs failed only on the absent intended surface or the exact
precision/accessor behavior under test. The final focused suite passes 13/13
runtime cases plus its direct-source public type fixture.

## Verification

Pinned runtime: Node `v22.22.3`, pnpm `10.11.1` via Corepack.

- `pnpm run test:wp4-http-metadata`: pass, runtime 13/13 plus public types.
- `pnpm run test:wp4-wire`: pass, runtime 18/18 plus public types.
- `pnpm run test:wp4-dispatcher`: pass, runtime 20/20 plus public types.
- `pnpm run test:wp4-stdio`: pass, runtime 20/20 plus public types.
- `pnpm run test:wp2-review`: pass, 16/16.
- `pnpm run test:wp3-schema`: pass, 28/28.
- `pnpm run test:wp3-protocol`: pass, 14/14.
- `sources:check`, generated, generated-protocol-surface, invariant, schema
  fixture, public type, unit-readiness, integration-readiness, build, and
  `git diff --check`: pass.
- Full `pnpm run verify` and draft E2E were not rerun at this intermediate
  slice; they remain required at the final Task 4D head.

## Surprises and environment compounding

- Positive: the generated HTTP descriptors were already precise enough to
  eliminate a second hand-maintained method/name table.
- Negative: ordinary `Number` comparison rounded non-integer decimal headers
  onto safe body integers, including values near the safe-integer boundary.
- Independent review also exposed two platform-boundary traps: the default
  `TextDecoder` strips a leading BOM, and `for...of` executes array getters.
- Durable positive change: the exact normative transport page is now an
  ordinary offline source snapshot with a pinned manifest hash.
- Durable negative prevention: focused tests lock strict sentinel decoding,
  accessor-safe whole-schema scanning, exact decimal/exponent integer
  comparison, immutable filtering, and safe warning diagnostics.

## Remaining risks and next actions

- Task 4D1 needs independent rereview with no Critical or Important finding
  and coordinator exact-head verification.
- The catalog filter is deliberately a transport-boundary hook; Task 4D3 must
  consume it when the modern HTTP server adapter is rewritten.
- The legacy HTTP/SSE/WebSocket/session paths remain until sequential Tasks
  4D2-4D4. No removal or transport integration was performed early.
- Task 4D2 must start with a separate inventory/public-boundary checkpoint and
  committed RED tests only after Task 4D1 acceptance.

## Independent review cycle 1

Independent review at exact head `e8a3e66` reported no Critical finding and
two Important findings:

1. The shared fatal UTF-8 `TextDecoder` used its default BOM handling, so a
   leading U+FEFF did not round-trip and both standard and custom validation
   could false-mismatch.
2. Schema-array `for...of` traversal invoked indexed accessors. Nonthrowing
   accessors were evaluated and throwing accessors escaped the typed analyzer,
   allowing one malformed tool to block filtering of later valid tools.

RED commit `0e8ad78` added leading-BOM encode/decode plus standard/custom
validation cases and both nonthrowing and throwing array-index accessor cases.
The exact focused result was build and public types green, runtime 10/13: BOM
decode lost U+FEFF, standard validation returned `HeaderMismatchError`, and the
nonthrowing array getter was invoked and produced the wrong typed reason.

GREEN commit `5328bbf` sets `ignoreBOM: true` on the fatal decoder and traverses
schema arrays only through own property descriptors, rejecting accessors
without invocation and retaining cycle detection. Post-fix verification:

- `pnpm run test:wp4-http-metadata`: 13/13 plus public types.
- `pnpm run sources:check`: pass.
- Task 4A: 18/18; Task 4B: 20/20; Task 4C: 20/20.
- Task 3A: 28/28; Task 3B: 14/14; WP2: 16/16.
- Generated, generated-protocol-surface, invariant, schema fixture, public
  type, unit-readiness, integration-readiness, build, and `git diff --check`:
  pass.

The review findings are fixed, but Task 4D1 remains pending independent
rereview and coordinator acceptance. Task 4D2 has not started.
