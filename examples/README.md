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

To inspect example and SDK spans in Effect DevTools, set
`MCP_EFFECT_DEVTOOLS_URL=ws://127.0.0.1:34437`. See the
[observability guide](../docs/observability.md).

## Active examples

| File                            | What it demonstrates                                                                                                     |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `everything-server.ts`          | Full stable `2026-07-28` server over Streamable HTTP, including the protected-resource token verifier seam.              |
| `everything-client.ts`          | Matching client, with the OAuth client provider wired in. Drive scenarios with `MCP_CONFORMANCE_SCENARIO`.               |
| `core-protocol-catalog.ts`      | One callable per core protocol method, over both stdio and HTTP. Used as the fixture source for several transport tests. |
| `agent-facing-proof-servers.ts` | Minimal servers used as proof fixtures by the tier-operations checks.                                                    |
| `everything-server-fixtures.ts` | Shared JSON Schema 2020-12 fixtures for the two Everything programs.                                                     |

## Additional active suites

- `typescript-sdk-ports/` contains current-public-API ports and an eight-story
  parity smoke executable.
- `task-heavy/` demonstrates the current `io.modelcontextprotocol/tasks`
  experimental extension surface.

Both trees are compiled by `examples/tsconfig.json` and covered by repository
verification.
