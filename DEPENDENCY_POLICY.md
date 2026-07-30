# Dependency Update Policy

This is the canonical, published dependency policy for `mcp-effect-sdk`.

## Runtime dependencies

- Runtime dependencies are pinned by `pnpm-lock.yaml` and reviewed through pull
  requests.
- Dependabot opens weekly pnpm updates. Security updates may be merged outside
  the normal cadence after the full verification gate passes.
- Production dependency changes require `pnpm install --frozen-lockfile`,
  `pnpm run verify`, and a packed-consumer test.
- `effect` and any `@effect/*` packages must remain on compatible versions.

## MCP specification inputs

Protocol sources are not updated from a moving branch. `sources/manifest.json`
pins the final MCP schema, specification documents, licenses, and exact upstream
commit used to generate the SDK.

An MCP source update must:

1. refresh one named source through `pnpm run sources:refresh`;
2. review the semantic diff and update source provenance;
3. regenerate the protocol artifacts;
4. run the full server and client conformance inventories; and
5. update the feature coverage matrix and migration notes.

`pnpm run sources:check` is network-free and rejects unrecorded drift.

## Conformance harness

The private `test/conformance` workspace pins
`@modelcontextprotocol/conformance` exactly. Harness updates are reviewed like
protocol inputs: enumerate the applicable scenarios, run `server --suite all`,
`client --suite all`, and the focused client-auth suite, then publish a
same-commit composite evidence artifact.

Local failure allowlists are forbidden. A pending, skipped, or disputed test is
excluded only when the official harness itself classifies it that way; the
artifact retains that upstream classification.

## Cadence and ownership

- Routine dependency review: weekly.
- MCP security or correctness releases: as soon as practical, with P0 handling
  governed by [MAINTENANCE.md](MAINTENANCE.md).
- MCP release-candidate tracking: starts when the Working Group publishes the
  candidate timeline and remains on the public [roadmap](ROADMAP.md).

The previous path, `docs/conformance/dependency-update-policy.md`, remains a
short link to this canonical policy.
