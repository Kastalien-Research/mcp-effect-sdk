# Effect v4 migration

This SDK targets **Effect 4.0.0-rc.112**. The migration permits breaking changes
and uses native v4 APIs. The package version is unchanged until the checked-in
major changeset is released; this branch does not publish a package.

## Install and imports

Use the exact `effect@4.0.0-rc.112` peer. Node examples use the matching
`@effect/platform-node@4.0.0-rc.112`. HTTP, RPC, and DevTools moved into Effect:

```ts
import * as Effect from "effect/Effect"
import * as Schema from "effect/Schema"
import * as HttpRouter from "effect/unstable/http/HttpRouter"
```

The existing `mcp-effect-sdk/integrations/effect-platform` entrypoint remains,
but its layer uses v4 `HttpRouter.HttpRouter` and exposes the router's request
error requirement. Compose it with `HttpRouter.toWebHandler`. No separate
`@effect/platform`, `@effect/rpc`, or `@effect/experimental` dependency is
needed. TypeScript consumers should use modern package resolution and include
`DOM` and `ESNext.Disposable` in `lib`, as required by Effect's declarations.

## Schema and service changes

- Services use `Context.Service`. Schema constraints use `Schema.Top` or
  `Schema.Codec<A, I, DecodingServices, EncodingServices>`; decoding and
  encoding service requirements are distinct.
- Use `Schema.decodeUnknownEffect`, `Schema.encodeUnknownEffect`, and their
  `Result` variants. Synchronous error results use `Success`/`Failure` and
  `.success`/`.failure` instead of `Either`.
- Use `.annotate`, `.check`, `Schema.optionalKey`, and v4 default combinators.
  `Schema.optional` also permits `undefined`; its canonical JSON encoding can
  admit `null`. Choose `optionalKey` when only key omission is intended.
- Tool schemas use `Schema.toJsonSchemaDocument` and canonical
  `Schema.toCodecJson` decoding. Use `Schema.Finite` for ordinary JSON numbers.
  `Schema.Number` also advertises and decodes v4's string representations of
  infinities and `NaN`.
- Native `identifier` annotations and `Schema.Class` inputs retain their
  `$ref`/`$defs` representation. Custom JSON Schema filters use
  `Schema.makeFilter(predicate, { toJsonSchema: () => fragment })`. Unsupported
  opaque declarations fail registration instead of advertising an unconstrained
  input. Vendor `x-` annotations are retained. Put JSON Schema applicators whose
  object scope matters (`allOf`, `if`/`then`/`else`) and anchors on `.annotate`;
  a filter's `toJsonSchema` fragment can be nested under `allOf`. Supply the
  corresponding runtime validation in the schema's checks. Use `optionalKey` for
  an optional `x-mcp-header` string field.
- Registered tool and prompt codecs capture their decoding services.
  Resource-template completions capture encoding services for their returned
  values, in addition to the services needed to decode URI parameters.
- OAuth metadata codecs with renamed wire keys use `Schema.Struct` and
  `Schema.encodeKeys`. Construct/decode through those codecs; the old metadata
  class constructors are removed.

## Runtime changes

Effect callbacks, layers, streams, queues, and fibers use native v4 contracts.
Examples use `Effect.result`, `Effect.catch`, `Effect.forkChild`/`forkScoped`,
and captured `Context` runners. Request annotations use `Context.Reference`.

Failure causes have flat `reasons`. Error and defect values, interruptions, and
reason multiplicity remain available. Native tracing may annotate and copy a
Cause, so callback Cause container identity is not an API guarantee. Error
values retain their identity. Subscription transports are consumed through a
native pull boundary that preserves foreign errors before completion checks.

The migration keeps strict JSON snapshots and validates schema instances before
encoding. After encoding, supported schema-class values become plain outbound
JSON. Accessors, cyclic values, custom non-schema prototypes, and invalid binary
views continue to fail closed.

## Protocol and architecture

The SDK remains an independent implementation of MCP `2026-07-28`, with
stateless discovery, MRTR, scoped subscriptions, cancellation, authorization,
and JSON/SSE/stdio transports. Familiar TypeScript SDK operations remain
`registerTool`, `registerResource`, `registerPrompt`, `listTools`, and
`callTool`; Effects, Layers, Scopes, and Effect Schema express their runtime
contracts.

The installed RC's native MCP implementation supports revisions only through
`2025-11-25`. Its `McpReverseClient` does not replace this SDK's full client and
modern protocol lifecycle. Replacing the protocol engine now would remove
supported behavior. Reconsider native delegation when the released package
supports the same revision and the existing interoperability tests pass through
the adapter.

Using Effect Schema instead of Zod does not by itself prevent MCP wire
conformance. Official SDK recognition and Tier 1 designation additionally depend
on the published SDK requirements and Working Group review.

## References

- [Effect migration guide](https://github.com/Effect-TS/effect/blob/main/MIGRATION.md)
- [Effect Schema guide](https://github.com/Effect-TS/effect/blob/main/packages/effect/SCHEMA.md)
- [August RC recap](https://effect.website/blog/effect-v4-rc-august-recap)
- [Exact RC native MCP source](https://github.com/Effect-TS/effect/blob/effect%404.0.0-rc.112/packages/effect/src/unstable/ai/McpSchema.ts)
- [Pre-migration review](../reviews/2026-09-05-effect-v4-review.md)
