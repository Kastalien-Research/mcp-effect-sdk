# AGENTS.md

## Cursor Cloud specific instructions

### Product

`mcp-effect-sdk` is a standalone Effect-native MCP (Model Context Protocol) SDK
for TypeScript. There is no web UI, Docker Compose stack, or database.
Development and verification are Node/pnpm only.

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

| Goal                                                              | Command                                            |
| ----------------------------------------------------------------- | -------------------------------------------------- |
| Package-health CI gate (checks + unit + integration + e2e)        | `pnpm run verify`                                  |
| Separate client-auth conformance baseline                         | `pnpm run conformance:client-auth`                 |
| TypeScript build                                                  | `pnpm run build`                                   |
| Self-hosted draft MCP e2e                                         | `pnpm run e2e:draft`                               |
| Historical/external conformance harness (not draft-authoritative) | `pnpm run conformance:run`                         |
| Unit / integration only                                           | `pnpm run test:unit` / `pnpm run test:integration` |

`pnpm test` is an alias for `pnpm run verify`.

### Running the Everything conformance server manually

Most tests spawn servers on ephemeral ports. For interactive debugging on a
fixed port:

```bash
pnpm run build
HOST=127.0.0.1 PORT=3000 pnpm run conformance:server
```

Endpoint: `http://127.0.0.1:3000/mcp` (Streamable HTTP; POST JSON-RPC with
`Accept: application/json, text/event-stream`).

Example client scenarios (after build):

```bash
MCP_CONFORMANCE_SCENARIO=basic node dist/examples/everything-client.js http://127.0.0.1:3000/mcp
```

### Gotchas

- **ESLint and Prettier are wired up** — `pnpm run lint` checks both, and
  `pnpm run verify` runs it. Settings follow the Effect convention (two-space,
  no semicolons, double quotes), not the official TypeScript SDK's. Generated
  and vendored trees are excluded; see `.prettierignore`.
- **Effect diagnostics are a gate** — `pnpm run check:effect-lsp` runs the
  `@effect/language-service` diagnostics that only editors normally see. New
  error-severity findings fail the build unless listed in
  `effect-lsp-baseline.json` with a reason. Do not add entries without one.
- **Source-matching checks must tolerate re-wrapping** — several `check:*`
  scripts assert on the text of source and Markdown files. Prettier owns line
  breaks now, so match with a whitespace-tolerant regex or a
  `.replace(/\s+/g, " ")` projection rather than a multi-line literal.
- **Examples live at `examples/`, not `src/examples/`** — they build via
  `examples/tsconfig.json` into `dist/examples/` and import the SDK by package
  name. Run `pnpm run build` before `conformance:server` or `dist/examples/*`
  clients.
- **pnpm build-script warning** — `msgpackr-extract` may show as ignored; full
  `verify` still passes without `pnpm approve-builds`.
- **Evidence artifacts** — conformance and readiness output default under
  `.local/` (gitignored).
