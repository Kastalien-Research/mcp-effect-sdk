# Applications

Runnable applications that live in this repository but are **not** part of the
published `mcp-effect-sdk` package. Nothing under `apps/` is built by
`pnpm run build`, exported from the package, or covered by `pnpm run verify`.

The official TypeScript SDK has no direct equivalent; its closest analogue is
the top-level `examples/` workspace. The distinction this directory draws is
between _examples_, which demonstrate the SDK's public surface and are gated by
`test:examples`, and _applications_, which are development aids with their own
lifecycles.

| App                                | What it is                                                                                                                                                                                                |
| ---------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`visual-effect/`](visual-effect/) | Effect MCP IDE — a visual workbench for authoring, running, and inspecting MCP applications. Based on [Visual Effect](https://github.com/kitlangton/visual-effect) by Kit Langton; see its `UPSTREAM.md`. |

## Why these are not pnpm workspace members

`visual-effect` runs on its own toolchain: Bun, Biome, Next.js, and its own
`bun.lock`. Two things have to change before it can join the pnpm workspace:

1. **The single-Effect-runtime policy.** `scripts/effect-foundation-policy.mjs`
   requires `pnpm-lock.yaml` to resolve _exactly one_ Effect runtime, at
   `3.22.0`. `visual-effect` pins `effect@^3.19.14`. Adding it to the workspace
   as-is makes `pnpm run verify` fail on `check:effect-foundation`. The app has
   to move to `3.22.0` first, and that needs a real `next build` to validate.
2. **One package manager.** Joining the workspace means deleting `bun.lock` and
   resolving the Next.js, Tailwind, and Wrangler dependency graph under pnpm.

Until both are done, the app stays self-contained and the SDK's tooling stays
out of it: it is excluded from `eslint.config.mjs`, `.prettierignore`, and both
`tsconfig.json` files, and it keeps Biome for its own linting and formatting.

## Working on it

```bash
cd apps/visual-effect
bun install --frozen-lockfile
bun run dev
```

`visual-effect` does not currently import `mcp-effect-sdk`; its MCP behaviour is
fixture-driven. Wiring it to the real SDK is what makes the workspace
unification worth doing, and is tracked with the Apps lane work in
`docs/internal/plans/`.
