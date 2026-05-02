# MCP Effect SDK

This directory is the primary standalone Effect-native MCP SDK target.

Start here:

1. `ROADMAP.md`, especially its Invariants section.
2. `docs/sdk-generator-workflow.md` for the SEP-informed generator workflow.
3. `package.json` for package boundary, scripts, and dependencies.
4. `src/` for the active SDK source.
5. `mcp/` only as older duplicated source/test material until it is reconciled.

## Current Package Shape

- `src/McpSchema.ts` exposes the Effect schema facade over generated MCP schema
  data.
- `src/generated/mcp/` contains generated stable `2025-11-25` MCP protocol
  schema and metadata.
- `src/McpClient.ts`, `src/McpServer.ts`, and `src/McpClientProtocol.ts` are the
  core client/server/protocol modules.
- `src/transport/` contains HTTP and stdio transport work.
- `src/client-handlers/` contains roots, sampling, and elicitation handlers.
- `mcp/` contains older duplicated source plus tests; treat it as evidence to
  reconcile, not as the active package source.

## Commands

```bash
pnpm run verify
```

`pnpm test` currently runs package verification. Behavioral tests still need to
be generated or ported into the active `src/` workflow.
