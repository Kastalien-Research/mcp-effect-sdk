# Observability

This document describes how the MCP Effect SDK classifies observability work.

## Coverage inventory

`docs/observability-inventory.json` is the source of truth for whether files
are:

- `instrumented`
- `coveredByParentBoundary`
- `rootOnly`
- `generated`
- `pureExempt`
- `quarantined`

The file is validated by `pnpm run check:observability-coverage`. A repository
file must match at least one configured coverage path, and each quarantined item
must include a prerequisite before being treated as production active.

## Dependency policy

- Root dependency policy keeps `@effect/experimental` pinned at `0.61.0` in
  `devDependencies` only.
- The visual app keeps the same pinned `@effect/experimental` version in
  `devDependencies` and does not declare it as a runtime dependency.
- Tracing helpers in scripts/examples/apps should import DevTools only through
  the local helper modules and only when their exported layer is explicitly
  enabled with environment variables.

## Tracing boundary rule

Span capture should be placed on Effect boundaries (`withSpan`, `Effect.fn`,
`Effect.withSpan`, etc.) rather than every byte, line, or queue operation.
