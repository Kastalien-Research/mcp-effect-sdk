# Dependency Update Policy

This package is a pnpm package. Use `pnpm-lock.yaml` and package-local scripts in
this directory for SDK work:

```bash
pnpm install --frozen-lockfile
pnpm run verify
```

The sibling conformance checkout at `../conformance` is an npm package. Use its
`package-lock.json` from that directory or via npm prefix:

```bash
npm --prefix ../conformance ci
npm --prefix ../conformance run build
```

Do not mix package managers across the boundary:

- no `npm install` in `mcp-effect-sdk/`
- no `pnpm install` in `../conformance`
- no generated conformance artifacts committed into this package

Dependency updates should preserve exact lockfile ownership and rerun the
verification command for the package whose lockfile changed.
