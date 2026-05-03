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

## Current Package Shape

- `src/McpSchema.ts` exposes the Effect schema facade over generated MCP schema
  data.
- `src/generated/mcp/` contains generated stable `2025-11-25` MCP protocol
  schema and metadata.
- `src/McpClient.ts`, `src/McpServer.ts`, and `src/McpClientProtocol.ts` are the
  core client/server/protocol modules.
- `src/examples/everything-server.ts` is the Everything-style conformance
  server.
- `src/transport/` contains HTTP and stdio transport work.
- `src/client-handlers/` contains roots, sampling, and elicitation handlers.
- `docs/conformance/historical-mcp-reconciliation.md` records the cleanup of the
  older duplicated `mcp/` implementation tree.

## Commands

```bash
pnpm run verify
```

`pnpm test` currently runs package verification. Conformance runs are explicit:

```bash
pnpm run conformance:run
```
