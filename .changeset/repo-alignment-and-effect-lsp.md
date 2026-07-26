---
"mcp-effect-sdk": patch
---

Fix the package build and narrow what ships.

`pnpm run build` previously exited non-zero —
`src/examples/typescript-sdk-ports/` had not compiled since the `2026-07-28`
rewrite — but still emitted JavaScript, because nothing set `noEmitOnError`.
Examples now build from their own `examples/tsconfig.json` with `noEmitOnError`
on, and the stale ports are quarantined rather than silently shipped as broken
output.

`package.json` also gains a `files` allowlist, so published tarballs contain
`dist/` (excluding `dist/examples/`), the README, the licence, and the
third-party notices, instead of everything not gitignored. The declared licence
is now `MIT`, with a `LICENSE` file to match; it was previously `ISC` with no
licence file present.

No public API changed.
