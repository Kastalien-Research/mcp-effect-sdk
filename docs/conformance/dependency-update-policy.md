# Dependency Update Policy

This repository is a pnpm workspace. Use the root `pnpm-lock.yaml` and
package-local scripts in this directory for SDK work:

```bash
pnpm install --frozen-lockfile
pnpm run verify
```

The conformance harness is owned by the in-repo private package at
`test/conformance`. It pins `@modelcontextprotocol/conformance` in
`test/conformance/package.json`, and the root lockfile records the resolved
dependency graph. CI must use this package, not any sibling checkout on a
developer machine.

```bash
pnpm --dir test/conformance exec conformance --help
pnpm run conformance:run
```

A local checkout of the upstream conformance project may be linked for
debugging, but that is optional local state and must not be required by package
scripts or CI.

Do not mix package boundaries:

- no `npm install` in this repository
- no package scripts that reach into `../conformance`
- no generated conformance artifacts committed into this package

Dependency updates should preserve exact lockfile ownership and rerun the
verification command for the package whose dependency changed.
