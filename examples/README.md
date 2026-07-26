# Examples

Runnable programs that exercise the SDK through its **published export surface**
only — every import here uses a `mcp-effect-sdk/*` subpath, never a relative
reach into `src/`. If an example cannot be written without a deep import, that
is a gap in the export map, not a reason to reach past it.

Build them with the SDK, then run from `dist/`:

```bash
pnpm run build
node dist/examples/everything-server.js
```

## Active examples

| File                            | What it demonstrates                                                                                                     |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `everything-server.ts`          | Full draft-`2026-07-28` server over Streamable HTTP, including the protected-resource token verifier seam.               |
| `everything-client.ts`          | Matching client, with the OAuth client provider wired in. Drive scenarios with `MCP_CONFORMANCE_SCENARIO`.               |
| `core-protocol-catalog.ts`      | One callable per core protocol method, over both stdio and HTTP. Used as the fixture source for several transport tests. |
| `agent-facing-proof-servers.ts` | Minimal servers used as proof fixtures by the tier-operations checks.                                                    |
| `everything-server-fixtures.ts` | Shared JSON Schema 2020-12 fixtures for the two Everything programs.                                                     |

## Quarantined directories

These are excluded from `examples/tsconfig.json`. They are kept on disk as
adaptation material and are **not** built, run, or covered by any gate.

### `typescript-sdk-ports/`

Ports of official TypeScript SDK examples, written against the pre-`2026-07-28`
SDK surface. They no longer compile: they import a `McpClientProtocol` module
removed in `60d9598`, and they predate `resultType` on tool results, the
`McpServerService` shape, and the current progress/logging APIs — 31 type errors
across five files.

They were silently emitting broken JavaScript because the root build had no
`noEmitOnError`. Re-authoring or retiring them is tracked by
[#35](https://github.com/Kastalien-Research/mcp-effect-sdk/issues/35); until
then they stay excluded so `pnpm run build` reports honestly.

### `task-heavy/`

Depends on `src/McpTasks.ts`, which left the core protocol in MCP `2026-07-28`.
Both come back when tasks are re-authored as the `io.modelcontextprotocol/tasks`
extension. See `docs/draft-2026-07-28-migration.md` and #15.
