# Frozen source provenance

The source inventory in `sources/manifest.json` records the current independently versioned inputs for the MCP `2026-07-28` alignment. `sources/audited-baseline.json` is the immutable WP1 baseline: its own hash is enforced by `pnpm run sources:check`, and every current source points back to its audited revision/version. The check validates every current vendored byte and license network-free. A Git revision identifies the wider upstream repository; the manifest's explicit file list identifies the bytes this package actually vendors and verifies.

## Core schema hash correction

On 2026-07-17, two independent reads of `modelcontextprotocol/modelcontextprotocol@26897cc322f356487da89113451bd16b520b9288` established these immutable SHA-256 values:

- `schema/draft/schema.ts`: `c56f0ad2395f9f7109a903a304344a61c65555cb0b2d28c1635cc32497221c87`
- `schema/draft/schema.json`: `9281c4890630e2d1e61792fa23b4084c4ea360cd58519610cd050545ab7b8708`

The initial plan and task brief ended the JSON value in `870e`. That one-character transcription error was corrected to `8708` with explicit user authorization; no upstream source was changed to fit the plan.

The frozen vendor snapshot is the sole generation authority. Work package 3 removed the former raw copies under `src/generated/mcp/2026-07-28`; deterministic Effect codecs and protocol facts under `src/generated/mcp/` are now derived directly from the pinned files in `sources/vendor/mcp-core/`.

## Authorization prose expansion at the audited revision

WP6 expands the current `mcp-core` file inventory without changing its audited
revision. Two independent reads on 2026-07-19 established these exact files and
SHA-256 values at
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
unchanged. `sources/manifest.json` records this later file-inventory expansion
at the same audited revision, and `pnpm run sources:check` independently
requires exactly one matching upstream path, vendored path, and SHA-256 tuple
for each of the four current authorities while validating every vendored byte
network-free. Missing, duplicate, relocated, or malformed authority tuples are
rejected. The authorization prose has higher authority than the pinned
conformance harness and the TypeScript SDK or local PR design oracles.

Stable Apps has two independently checked anchors: the Git specification revision and the npm interoperability oracle. The exact registry metadata for `@modelcontextprotocol/ext-apps@1.7.4` is vendored at `sources/vendor/apps-stable/npm-metadata.json` with SHA-256 `4cd5b778acd40666206609b7b1623d30282192d8b5f3fccd0938199fd114fd76`; its registry `dist.integrity` is `sha512-QQqysE549cf/Y0VabBmAACXhj92EhB3t8yVct2BHbkWiPTFA1S91EqTVjYXXcZEefXU0pmHcdObhsNMcomJIOQ==`.

## Refresh boundary

`pnpm run sources:refresh -- --source <id> --revision <full-sha>` selects exactly one current manifest entry, downloads only its recorded paths, verifies the new revision, and writes an old/new semantic-diff report under `.local/source-refresh`. It exits without source changes unless `--apply` is explicit. Apply mode changes only that source's current vendor files/revision/hashes and manifest entry; it never rewrites `auditedBaseline` or `sources/audited-baseline.json`. It records a checked-in refresh report, runs its declared generation command when applicable, and exits nonzero until its reconciliation note names both revisions and every declared fixture path is updated.

Never use the refresh tool to adopt an unreviewed branch, tag, default-branch drift, or a second source opportunistically.
