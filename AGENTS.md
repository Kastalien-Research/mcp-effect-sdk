# AGENTS.md

## Cursor Cloud specific instructions

### Product

`mcp-effect-sdk` is a standalone Effect-native MCP (Model Context Protocol) SDK for TypeScript. There is no web UI, Docker Compose stack, or database. Development and verification are Node/pnpm only.

### Prerequisites

- **Node.js 22** (matches `.github/workflows/verify.yml`)
- **pnpm 10.11.1** via Corepack (`packageManager` in `package.json`)

### Dependency refresh (automatic on VM startup)

See the repo `SetupVmEnvironment` update script. After pull, from repo root:

```bash
corepack enable
pnpm install --frozen-lockfile
```

### Primary commands

| Goal | Command |
|------|---------|
| Package-health CI gate (checks + unit + integration + e2e) | `pnpm run verify` |
| Separate client-auth conformance baseline | `pnpm run conformance:client-auth` |
| TypeScript build | `pnpm run build` |
| Self-hosted draft MCP e2e | `pnpm run e2e:draft` |
| Historical/external conformance harness (not draft-authoritative) | `pnpm run conformance:run` |
| Unit / integration only | `pnpm run test:unit` / `pnpm run test:integration` |

`pnpm test` is an alias for `pnpm run verify`.

### Running the Everything conformance server manually

Most tests spawn servers on ephemeral ports. For interactive debugging on a fixed port:

```bash
pnpm run build
HOST=127.0.0.1 PORT=3000 pnpm run conformance:server
```

Endpoint: `http://127.0.0.1:3000/mcp` (Streamable HTTP; POST JSON-RPC with `Accept: application/json, text/event-stream`).

Example client scenarios (after build):

```bash
MCP_CONFORMANCE_SCENARIO=basic node dist/examples/everything-client.js http://127.0.0.1:3000/mcp
```

### Gotchas

- **No ESLint/Prettier in repo** — static quality is enforced by custom `check:*` scripts inside `pnpm run verify`, not a separate linter CLI.
- **Examples run from `dist/`** — run `pnpm run build` before `conformance:server` or `dist/examples/*` clients.
- **pnpm build-script warning** — `msgpackr-extract` may show as ignored; full `verify` still passes without `pnpm approve-builds`.
- **Evidence artifacts** — conformance and readiness output default under `.local/` (gitignored).
