# Frozen source provenance

The source inventory in `sources/manifest.json` records the current
independently versioned inputs for the MCP `2026-07-28` alignment.
`sources/audited-baseline.json` is the immutable WP1 baseline: its own hash is
enforced by `pnpm run sources:check`, and every current source points back to
its audited revision/version. The check validates every current vendored byte
and license network-free. A Git revision identifies the wider upstream
repository; the manifest's explicit file list identifies the bytes this package
actually vendors and verifies.

## Stable 2026-07-28 release refresh

The active MCP core snapshot advances from the reviewed draft commit
`26897cc322f356487da89113451bd16b520b9288` to the official stable tag commit
`5f5440bb26a62e2cf3440b92da5a667efa03b267`. The release keeps the protocol
version and generated package subpath at `2026-07-28`; it replaces the moving
draft locations with these reviewed dated-path migrations:

- `schema/draft/schema.ts` -> `schema/2026-07-28/schema.ts`
- `schema/draft/schema.json` -> `schema/2026-07-28/schema.json`
- `docs/specification/draft/index.mdx` ->
  `docs/specification/2026-07-28/index.mdx`
- `docs/specification/draft/basic/transports/streamable-http.mdx` ->
  `docs/specification/2026-07-28/basic/transports/streamable-http.mdx`
- `docs/specification/draft/basic/authorization/index.mdx` ->
  `docs/specification/2026-07-28/basic/authorization/index.mdx`
- `docs/specification/draft/basic/authorization/authorization-server-discovery.mdx`
  ->
  `docs/specification/2026-07-28/basic/authorization/authorization-server-discovery.mdx`
- `docs/specification/draft/basic/authorization/client-registration.mdx` ->
  `docs/specification/2026-07-28/basic/authorization/client-registration.mdx`
- `docs/specification/draft/basic/authorization/security-considerations.mdx` ->
  `docs/specification/2026-07-28/basic/authorization/security-considerations.mdx`

`LICENSE` retains its upstream path. The checked-in report at
`sources/refresh-history/mcp-core/26897cc322f356487da89113451bd16b520b9288..5f5440bb26a62e2cf3440b92da5a667efa03b267.json`
records the old and new revision, path, hash, and semantic diff for every
vendored file. The active `sha256` values in `sources/manifest.json` are the
sole hash authority consumed by generation and source checks; neither script
duplicates the current release hashes.

This refresh does not rewrite the historical WP1 inventory.
`sources/audited-baseline.json` remains byte-for-byte identical and the active
manifest continues to point back to its audited draft revision.

## Audited draft schema hash correction

On 2026-07-17, two independent reads of
`modelcontextprotocol/modelcontextprotocol@26897cc322f356487da89113451bd16b520b9288`
established these immutable SHA-256 values:

- `schema/draft/schema.ts`:
  `c56f0ad2395f9f7109a903a304344a61c65555cb0b2d28c1635cc32497221c87`
- `schema/draft/schema.json`:
  `9281c4890630e2d1e61792fa23b4084c4ea360cd58519610cd050545ab7b8708`

The initial plan and task brief ended the JSON value in `870e`. That
one-character transcription error was corrected to `8708` with explicit user
authorization; no upstream source was changed to fit the plan.

At that audited baseline, the frozen vendor snapshot became the sole generation
authority. Work package 3 removed the former raw copies under
`src/generated/mcp/2026-07-28`; deterministic Effect codecs and protocol facts
under `src/generated/mcp/` remain derived directly from the current files in
`sources/vendor/mcp-core/` pinned by the manifest.

## Authorization prose expansion at the audited revision

WP6 expanded the then-current `mcp-core` file inventory without changing its
audited revision. Two independent reads on 2026-07-19 established these exact
files and SHA-256 values at
`modelcontextprotocol/modelcontextprotocol@26897cc322f356487da89113451bd16b520b9288`:

- `docs/specification/draft/basic/authorization/index.mdx`:
  `4e1e0b760e8c9ff7bc322502dccf4450cd626036648b8221f66eb4be371da3c3`
- `docs/specification/draft/basic/authorization/authorization-server-discovery.mdx`:
  `22e2841a5e561afa1bd246c9e3cac64392402b3cac19d33da1e5d0987ccb3df8`
- `docs/specification/draft/basic/authorization/client-registration.mdx`:
  `462d87866544bef7ce44fcbd6fcbb615eb30708e635d4d33a72ea7ae49866c23`
- `docs/specification/draft/basic/authorization/security-considerations.mdx`:
  `592befe83fe38e7184fda6e18a4dfba9748ab50280ea31fe1ad64974065a1612`

The immutable WP1 `sources/audited-baseline.json` remains byte-for-byte
unchanged. The release-refresh report retains these draft hashes as each file's
`oldSha256`; the active manifest now records the dated final paths and hashes.
`pnpm run sources:check` still rejects missing, duplicate, relocated, malformed,
or byte-mismatched current authority entries network-free. The authorization
prose has higher authority than the pinned conformance harness and the
TypeScript SDK or local PR design oracles.

Stable Apps has two independently checked anchors: the Git specification
revision and the npm interoperability oracle. The exact registry metadata for
`@modelcontextprotocol/ext-apps@1.7.4` is vendored at
`sources/vendor/apps-stable/npm-metadata.json` with SHA-256
`4cd5b778acd40666206609b7b1623d30282192d8b5f3fccd0938199fd114fd76`; its registry
`dist.integrity` is
`sha512-QQqysE549cf/Y0VabBmAACXhj92EhB3t8yVct2BHbkWiPTFA1S91EqTVjYXXcZEefXU0pmHcdObhsNMcomJIOQ==`.

## Released Tier policy and audit authority

The active readiness authority is the released
[SDK Tiers policy](https://modelcontextprotocol.io/community/sdk-tiers) together
with the official
[MCP SDK Tier audit rules](https://github.com/modelcontextprotocol/conformance/tree/main/.claude/skills/mcp-sdk-tier-audit).
The readiness registry and scheduled live audit use those released sources.
Neither source changes the protocol wire contract.

## Historical SEP-1730 provenance

`sources/vendor/sep-1730/1730-sdks-tiering-system.md` is pinned at
`modelcontextprotocol/modelcontextprotocol` revision
`7634684382c3d14cf7e9f14073fe40a2d8ace3fa`. It records the proposal-era policy
that preceded the released Tier policy. It is retained as historical governance
provenance, not as the current readiness authority and not as a protocol or
runtime input.

Before this historical pin, proposal-era rows cited
`../modelcontextprotocol/seps/1730-sdks-tiering-system.md` — a path outside the
repository that no checkout resolves. Pinning the proposal closed that
historical audit gap; the released policy and official audit now govern active
readiness accounting.

This source was vendored after the WP1 audit, so it carries an `auditedBaseline`
naming the inventory without a revision, and `sources/audited-baseline.json`
remains byte-for-byte unchanged. `scripts/check-source-snapshots.mjs` keeps the
manifest allowlist and the audited-baseline set separate for exactly this
reason.

## Refresh boundary

`pnpm run sources:refresh -- --source <id> --revision <full-sha>` selects
exactly one current manifest entry, downloads only its recorded paths, verifies
the new revision, and writes an old/new semantic-diff report under
`.local/source-refresh`. It exits without source changes unless `--apply` is
explicit. Apply mode changes only that source's current vendor
files/revision/hashes and manifest entry; it never rewrites `auditedBaseline` or
`sources/audited-baseline.json`. It records a checked-in refresh report, runs
its declared generation command when applicable, and exits nonzero until its
reconciliation note names both revisions and every declared fixture path is
updated.

When a release moves an authority to a dated upstream location, repeat
`--path-migration <old-upstream-path>=<new-upstream-path>` for each move. Apply
mode is blocked until the reconciliation note names both sides. The refresh
report records `oldUpstreamPath` and `newUpstreamPath` even for unchanged paths,
so path review remains auditable independently of current manifest state.

Never use the refresh tool to adopt an unreviewed branch, tag, default-branch
drift, or a second source opportunistically.
