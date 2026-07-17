# Frozen source provenance

The source inventory in `sources/manifest.json` records the current independently versioned inputs for the MCP `2026-07-28` alignment. `sources/audited-baseline.json` is the immutable WP1 baseline: its own hash is enforced by `pnpm run sources:check`, and every current source points back to its audited revision/version. The check validates every current vendored byte and license network-free. A Git revision identifies the wider upstream repository; the manifest's explicit file list identifies the bytes this package actually vendors and verifies.

## Core schema hash correction

On 2026-07-17, two independent reads of `modelcontextprotocol/modelcontextprotocol@26897cc322f356487da89113451bd16b520b9288` established these immutable SHA-256 values:

- `schema/draft/schema.ts`: `c56f0ad2395f9f7109a903a304344a61c65555cb0b2d28c1635cc32497221c87`
- `schema/draft/schema.json`: `9281c4890630e2d1e61792fa23b4084c4ea360cd58519610cd050545ab7b8708`

The initial plan and task brief ended the JSON value in `870e`. That one-character transcription error was corrected to `8708` with explicit user authorization; no upstream source was changed to fit the plan.

The frozen vendor snapshot is deliberately separate from `src/generated/mcp/2026-07-28`. At the start of this work package the active generated JSON and TypeScript-text fixtures hashed to `14398c3dd2c66b9c3f6661fc7a7eaa24174952ed1598d0b7f011b686ba5c4c83` and `51ac48a472a14e63b21af6ce430abbbca59a3c6551e02aa29f719e935261f71f`, respectively. Work package 1 does not switch generation inputs or regenerate protocol surfaces; that ordering belongs to work package 3.

Stable Apps has two independently checked anchors: the Git specification revision and the npm interoperability oracle. The exact registry metadata for `@modelcontextprotocol/ext-apps@1.7.4` is vendored at `sources/vendor/apps-stable/npm-metadata.json` with SHA-256 `4cd5b778acd40666206609b7b1623d30282192d8b5f3fccd0938199fd114fd76`; its registry `dist.integrity` is `sha512-QQqysE549cf/Y0VabBmAACXhj92EhB3t8yVct2BHbkWiPTFA1S91EqTVjYXXcZEefXU0pmHcdObhsNMcomJIOQ==`.

## Refresh boundary

`pnpm run sources:refresh -- --source <id> --revision <full-sha>` selects exactly one current manifest entry, downloads only its recorded paths, verifies the new revision, and writes an old/new semantic-diff report under `.local/source-refresh`. It exits without source changes unless `--apply` is explicit. Apply mode changes only that source's current vendor files/revision/hashes and manifest entry; it never rewrites `auditedBaseline` or `sources/audited-baseline.json`. It records a checked-in refresh report, runs its declared generation command when applicable, and exits nonzero until its reconciliation note names both revisions and every declared fixture path is updated.

Never use the refresh tool to adopt an unreviewed branch, tag, default-branch drift, or a second source opportunistically.
