# Historical MCP Reconciliation

## Historical test files reviewed

- `mcp/McpClient.test.ts`
- `mcp/McpClientError.test.ts`
- `mcp/McpClientProtocol.test.ts`
- `mcp/McpNotifications.test.ts`
- `mcp/McpSchema.test.ts`
- `mcp/McpSerialization.test.ts`
- `mcp/transport/HttpTransport.test.ts`
- `mcp/transport/StdioTransport.test.ts`

## Behavior ported

- Generated schema fixture checks cover representative encode/decode behavior:
  `scripts/check-generated-schema-fixtures.mjs`.
- Generated protocol-surface checks cover method metadata and dispatch
  alignment: `scripts/check-generated-protocol-surfaces.mjs`.
- Task runtime behavior is covered by `scripts/check-task-runtime.mjs`.
- Transport fixtures used by active source remain under `src/transport/`.
- Conformance-facing server behavior is mapped in
  `docs/conformance/scenario-map.md` and implemented in
  `src/examples/everything-server.ts`.

## Behavior intentionally dropped

- Tests for the obsolete duplicated implementation tree are not ported as-is.
- Historical tests that asserted implementation details of `mcp/**` are dropped
  because `src/**` is the active implementation boundary.
- Ad hoc repair/debug flows remain quarantined under `scratch/ad-hoc-scripts/`.

## Replacement active files

- `src/McpClient.ts`
- `src/McpServer.ts`
- `src/McpSerialization.ts`
- `src/McpNotifications.ts`
- `src/McpTasks.ts`
- `src/transport/HttpTransport.ts`
- `src/transport/StdioTransport.ts`
- `scripts/check-generated-protocol-surfaces.mjs`
- `scripts/check-generated-schema-fixtures.mjs`
- `scripts/check-task-runtime.mjs`
- `scripts/check-conformance-evidence.mjs`
- `scripts/check-historical-mcp-cleanup.mjs`
