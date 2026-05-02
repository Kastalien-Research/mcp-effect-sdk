# MCP Effect SDK Roadmap

This is the roadmap for `mcp-effect-sdk/`, the primary standalone
Effect-native MCP SDK package.

This is different from:

- `sep_submission_plan.md`, which is for submitting protocol extension SEPs.
- `mcp-effect-sep-drafts/1000-1002*.md`, which are implementation specs for
  upstream contribution work in `effect-smol/`.
- `effect-smol/`, which is the official Effect package checkout used for
  upstreaming selected pieces.

## Goal

Build a standalone MCP SDK that feels native to Effect and is generated from the
MCP protocol schema wherever the schema can define the surface.

The SDK should not hand-maintain protocol-shaped code. Requests, results,
notifications, capabilities, content types, method groups, schema codecs, client
methods, server handler slots, and fixture scaffolding should be generated from
stable MCP schema/spec inputs.

Handwritten code should be limited to:

- the generator itself
- small Effect runtime kernels that cannot be expressed by the schema
- transport I/O adapters for HTTP and stdio
- documented ergonomic helpers over the generated surface

The SDK may supply code or design back to `effect-smol`, but it is not merely a
prototype for `effect-smol`.

## Invariants

These rules are the source of truth for this package.

- `mcp-effect-sdk/` is the primary standalone SDK package. It is not scratch,
  reference-only, or merely a staging area for `effect-smol/`.
- The SDK is generated from MCP schema/spec artifacts wherever the schema can
  define the surface.
- `modelcontextprotocol/schema/2025-11-25/schema.json` and `schema.ts` are the
  stable protocol source of truth.
- `conformance/` is the behavioral acceptance suite and scenario catalog.
- If a shape, method, request, notification, result, capability, content type,
  or method group exists in the MCP schema, generate it.
- Handwritten code is limited to the generator, small Effect runtime kernels,
  transport I/O adapters, and explicitly documented ergonomic helpers.
- Handwritten protocol-shaped code is a bug unless the generator cannot express
  it yet and the gap is documented.
- Public SDK APIs must not use `any`. Raw JSON boundaries may use `unknown`,
  then immediately decode through generated schemas.
- Effect error channels must use concrete error types, not `any`.
- Generated output must be deterministic, timestamp-free, and idempotent.
- `src/` is the active implementation tree until the generator replaces it.
- `mcp/` is historical evidence and stranded tests, not active implementation.
- `dist/` is build output.
- Ad hoc repair scripts such as `fix-*.js`, `rewrite.js`, and
  `clean-fix.mjs` are not project tooling and should not be run.
- Do not infer SDK requirements from `effect-smol` specs unless this roadmap
  explicitly says a feature is being upstreamed.

## Current State

The active package source is `src/`.

Implemented or present:

- package boundary in `package.json`
- TypeScript build through `pnpm run build`
- generated MCP `2025-11-25` protocol schema and metadata in
  `src/generated/mcp/`
- schema facade in `src/McpSchema.ts`
- client/server/protocol modules in `src/McpClient.ts`, `src/McpServer.ts`, and
  `src/McpClientProtocol.ts`
- HTTP and stdio transport modules in `src/transport/`
- roots, sampling, and elicitation client handlers in `src/client-handlers/`
- built output in `dist/`

Unresolved:

- `mcp/` duplicates much of `src/` and contains tests that are not wired into the
  package test script.
- `fix-*.js`, `rewrite.js`, `clean-fix.mjs`, and inspection scripts appear to be
  ad hoc repair/migration utilities and need triage.
- package metadata is skeletal.
- test and conformance workflows are not reliable.
- the generator workflow for `src/generated/mcp/` is not documented inside this
  package.
- too much protocol-shaped code is currently handwritten or patched by hand
  instead of generated from MCP schema/spec inputs.

## Source-Of-Truth Rules

For implementation work, read these in order:

1. The invariants in this file.
2. MCP stable schema inputs under `modelcontextprotocol/schema/2025-11-25/`.
3. Conformance scenarios under `conformance/src/scenarios/`.
4. Active SDK source under `mcp-effect-sdk/src/`.
5. Historical tests and duplicated code under `mcp-effect-sdk/mcp/`.

## Architecture Targets

The intended stable module groups are:

- `generated/mcp/*`: generated schema codecs, type aliases, method metadata,
  request/result maps, capability maps, and conformance fixture metadata.
- `McpSchema`: a thin generated or generated-backed facade.
- `McpClient`: generated methods over a small handwritten request runtime.
- `McpServer`: generated handler registration surface over a small handwritten
  dispatch runtime.
- `McpNotifications`: generated notification helpers.
- `McpSerialization`: generated method/schema routing plus small handwritten
  JSON-RPC framing codecs.
- `transport/*`: handwritten concrete I/O adapters.
- `client-handlers/*`: generated callback surfaces plus handwritten user
  implementations.

Keep generated protocol facts under `src/generated/mcp/`; keep ergonomic
Effect-facing APIs either generated or visibly layered over generated metadata.

## Priority Plan

### 1. Build The Generator As The Center

- Add a package-local generation pipeline for `mcp-effect-sdk`.
- Vendor or reference stable MCP `2025-11-25` schema inputs deterministically.
- Generate schema codecs and type aliases from `schema.json`.
- Generate method groups, request/result pairings, notification groups, and
  protocol constants from `schema.ts`.
- Generate the public client method surface from request metadata.
- Generate the server handler registration surface from request metadata.
- Generate notification helpers from notification metadata.
- Generate conformance fixture metadata from `conformance/src/scenarios`.
- Make regeneration idempotent and checked by tests.

### 2. Replace Handwritten Protocol Surface

- Replace handwritten `McpSchema.ts` protocol declarations with generated
  output.
- Replace handwritten client request methods with generated methods.
- Replace handwritten server handler slots with generated registrations.
- Replace handwritten notification helpers with generated helpers.
- Keep only the runtime kernels that send, receive, dispatch, encode, decode,
  and manage transport/session lifecycle.
- Remove `any` introduced to patch generated-eligible protocol boundaries.

### 3. Generate Verification

- Replace the placeholder `test` script with a real test command.
- Add generated protocol parity checks against vendored `2025-11-25` inputs.
- Add generated encode/decode round-trip tests from representative schema
  fixtures.
- Add generated request/result dispatch tests from method metadata.
- Generate conformance fixture servers/clients for scenarios that are expressible
  as static protocol behavior.
- Keep handwritten tests only for runtime kernels and transport behavior.
- Add conformance scripts once generated examples can run as client/server
  targets.

### 4. Reconcile Or Delete Old Handwritten Trees

- Treat `mcp/` as historical evidence, not source of truth.
- Port only tests or behavior that still matters after the generator exists.
- Delete or archive duplicate handwritten implementation files.
- Quarantine ad hoc repair scripts; do not run them as project tooling.

### 5. Stabilize Public API And Upstream Boundaries

- Define which generated exports are public.
- Mark unstable or internal runtime kernels explicitly.
- Generate examples for basic server, basic client, tools, resources, prompts,
  sampling, roots, elicitation, notifications, and tasks.
- Identify which SDK pieces should be proposed for `effect-smol`.
- Keep upstream contribution specs in `effect-smol/.specs/` or clearly labeled
  upstream-only docs.
- Avoid making the standalone SDK roadmap depend on upstream acceptance.

## Near-Term Next Steps

1. Create the package-local generator entrypoint.
2. Generate the current `src/generated/mcp/*` outputs from MCP `2025-11-25`
   inputs.
3. Generate method metadata rich enough to drive client methods, server handler
   slots, notifications, and dispatch.
4. Replace handwritten protocol-shaped code with generated output.
5. Use `docs/sdk-generator-workflow.md` to turn SEP-1730, SEP-1686, and SEP-2133
   into SDK tier evidence, task runtime gates, and extension opt-in gates.
6. Wire generated parity/round-trip tests before porting old `mcp/` tests.

## Useful Commands

```bash
pnpm run verify
```

`pnpm test` runs verification for now. Behavioral tests remain unresolved until
they are generated or intentionally ported from `mcp/`.
