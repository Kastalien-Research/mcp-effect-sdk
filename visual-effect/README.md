# Effect MCP IDE

An Effect-native visual workbench for building, running, and understanding Model Context Protocol applications.

## Current checkpoint

The current runnable slice is a deterministic trace replay across an MCP client, capability gateway, vertical server, tool, and asynchronous Task. It proves the versioned graph document and trace projection that the authoring environment will use.

It is not yet the complete first pass. The UI says `FIXTURE REPLAY` because it does not currently connect to a live SDK process. Editable graph authoring, code/project generation, live execution, and MCP Apps Host/View preview remain subsequent increments.

## Run locally

The application follows the imported Visual Effect toolchain and uses Bun.

```bash
bun install --frozen-lockfile
bun run dev
```

Open `http://localhost:3000`.

## Verify

```bash
bun run test --run src/mcp-ide
bun run typecheck
bunx biome check biome.json app/ClientAppContent.tsx app/layout.tsx app/globals.css src/mcp-ide vitest.config.ts
bun run build
```

The full imported Visual Effect tree currently contains an upstream formatting/config mismatch. Keep MCP IDE checks scoped until that baseline is reconciled in a separate formatting-only change.

## Architecture

- `src/mcp-ide/model/` — versioned graph and trace contracts plus validation
- `src/mcp-ide/trace/` — interruptible Effect-backed replay controller
- `src/mcp-ide/scenarios/` — deterministic application/trace fixtures
- `src/mcp-ide/components/` — topology, execution rail, and inspector projections
- `../docs/brainstorms/2026-07-20-mcp-ide-brainstorm.md` — complete-first-pass product contract
- `../docs/plans/2026-07-20-mcp-ide-trace-first-plan.md` — checkpoint implementation and acceptance plan

Authoring and execution intentionally share node and edge identifiers. Future editor commands must mutate the graph document rather than introducing component-local topology state.

## Upstream

This application is based on Kit Langton's MIT-licensed [Visual Effect](https://github.com/kitlangton/visual-effect). See [UPSTREAM.md](./UPSTREAM.md) for the imported revision and adaptation notes.

## License

MIT — see [LICENSE](./LICENSE).
