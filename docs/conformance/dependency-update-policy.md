# Dependency Update Policy

This repository is a pnpm workspace. Use the root `pnpm-lock.yaml` and
package-local scripts in this directory for SDK work:

```bash
pnpm install --frozen-lockfile
pnpm run verify
```

The official conformance harness is owned by the in-repo private package at
`test/conformance`. It pins `@modelcontextprotocol/conformance` in
`test/conformance/package.json`, and the root lockfile records the resolved
dependency graph. MCP `2026-07-28` readiness/Tier qualification must use the
draft-targeted `0.2.x` conformance line from this package, not any sibling
checkout on a developer machine.

```bash
pnpm --dir test/conformance exec conformance --help
pnpm run conformance:run
pnpm run conformance:client-auth
pnpm run conformance:authorization
```

For package health, use `pnpm run verify` and `pnpm run e2e:draft`. Local
self-hosted E2E is not a substitute for official MCP conformance qualification.

`pnpm run conformance:authorization` is the draft-targeted authorization
command for #20. It requires `MCP_AUTHORIZATION_CONFORMANCE_FILE` or
`MCP_AUTHORIZATION_CONFORMANCE_URL`; missing configuration is recorded as a
blocker artifact rather than a readiness pass.

A local checkout of the upstream conformance project may be linked for
debugging, but that is optional local state and must not be required by package
scripts or CI.

Do not mix package boundaries:

- no `npm install` in this repository
- no package scripts that reach into `../conformance`
- no generated conformance artifacts committed into this package

Dependency updates should preserve exact lockfile ownership and rerun the
verification command for the package whose dependency changed.
