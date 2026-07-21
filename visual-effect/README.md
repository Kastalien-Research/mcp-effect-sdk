# Effect MCP IDE

An Effect-native visual workbench for building, running, and understanding Model Context Protocol applications.

## Current runnable pass

The current application has two modes and a project inspector over one versioned graph document:

- **Author** — add, position, configure, connect, duplicate, and remove typed MCP nodes; undo/redo graph commands; and import/export the exact graph JSON.
- **Project** — compile a supported authored graph into a deterministic backend-neutral IR and inspectable Effect scaffold, or show structured blockers without partial source.
- **Trace** — run, pause, step, cancel, reset, seek, and inspect deterministic MCP process fixtures projected onto the active graph.

The templates include a beginner content tool, a fixture-only core MRTR `input_required` retry, and a professional gateway/Tasks/Apps projection. The MRTR fixture stops at a real replay barrier, accepts one JSON value per exact server key, discards those values after submission, and resumes the same logical `tools/call` on fresh request ID 18. Its trace stores only request/response key evidence, SHA-256/length evidence for opaque request state, and `values: "not-retained"`.

This is not yet the complete first pass. Trace mode says `FIXTURE REPLAY` because it does not connect to a live SDK process. MRTR is a core request/retry pattern, not a durable Task: it has no task ID, polling state, durable handle, or durable cancellation. Live SDK execution remains gated on the reconciled public SDK surface; Tasks controls remain gated on accepted WP7; stable Apps integration remains gated on WP8; and Host/View preview remains gated on WP9.

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
bun run verify:mcp-ide -- --artifact-dir /tmp/mcp-ide-verifier
```

The full imported Visual Effect tree currently contains an upstream formatting/config mismatch. Keep MCP IDE checks scoped until that baseline is reconciled in a separate formatting-only change.

## Architecture

- `src/mcp-ide/model/` — versioned graph and trace contracts plus validation
- `src/mcp-ide/authoring/` — immutable graph commands, history, and document I/O
- `src/mcp-ide/trace/` — interruptible Effect-backed replay controller
- `src/mcp-ide/tasks/MrtrControls.tsx` — ephemeral fixture-only core retry input surface
- `src/mcp-ide/scenarios/` — deterministic application/trace fixtures
- `src/mcp-ide/components/` — topology, execution rail, and inspector projections
- `../docs/brainstorms/2026-07-20-mcp-ide-brainstorm.md` — complete-first-pass product contract
- `../docs/plans/2026-07-20-mcp-ide-trace-first-plan.md` — checkpoint implementation and acceptance plan

Authoring and execution intentionally share node and edge identifiers. UI gestures invoke validated graph commands rather than maintaining component-local topology state. A fixture trace is blocked if edits remove any node it references.

## Upstream

This application is based on Kit Langton's MIT-licensed [Visual Effect](https://github.com/kitlangton/visual-effect). See [UPSTREAM.md](./UPSTREAM.md) for the imported revision and adaptation notes.

## License

MIT — see [LICENSE](./LICENSE).
