# MCP Effect SDK

This directory is the primary standalone Effect-native MCP SDK target.

Start here:

1. `ROADMAP.md`, especially its Invariants section.
2. `docs/sdk-generator-workflow.md` for the SEP-informed generator workflow.
3. `docs/acceptance-gates/sdk-generator.md` for the phase gates that must be
   validated before continuing between generator work sections.
4. `package.json` for package boundary, scripts, and dependencies.
5. `src/` for the active SDK source.
6. `docs/conformance/` for Phase 6 conformance evidence and historical cleanup.
7. `docs/extensions.md` for the Phase 7 extension opt-in policy.

## Protocol version

This SDK targets the **`2026-07-28` MCP "stateless draft"** protocol as a clean
break from `2025-11-25`. The handshake, sessions, and server-initiated requests
are gone; `server/discover`, per-request `_meta`, `resultType`, MRTR, and
`subscriptions/listen` are in. See
[`docs/draft-2026-07-28-migration.md`](docs/draft-2026-07-28-migration.md) for
the migration status and the tracked follow-up work.

## Current Package Shape

- `src/McpSchema.ts` exposes the Effect schema facade over generated MCP schema
  data.
- `src/generated/mcp/2026-07-28/` contains the vendored draft MCP schema
  (`schema.ts`, `schema.json`); `src/generated/mcp/*.generated.ts` are the
  regenerated protocol facts.
- `src/McpClient.ts`, `src/McpServer.ts`, and `src/McpClientProtocol.ts` are the
  core client/server/protocol modules.
- `src/examples/everything-server.ts` is the Everything-style conformance
  server.
- `src/transport/` contains HTTP and stdio transport work.
- `src/client-handlers/` contains roots, sampling, and elicitation handlers.
- `docs/conformance/historical-mcp-reconciliation.md` records the cleanup of the
  older duplicated `mcp/` implementation tree.
- Extension capabilities are disabled by default and governed by
  `docs/extensions.md`.

## Commands

```bash
pnpm run verify
```

`pnpm test` currently runs package verification. Local draft E2E can be run
directly:

```bash
pnpm run e2e:draft
```

MCP readiness/Tier qualification requires official draft-targeted conformance:

```bash
pnpm run conformance:run
```
