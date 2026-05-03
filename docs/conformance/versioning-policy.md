# Versioning Policy

The package version is read from `package.json`.

Current status: no stable release is evidenced by this repository snapshot.
The `1.0.0` package metadata is not by itself sufficient for a Tier 2 or Tier 1
claim until release provenance, changelog/release notes, and conformance
results are recorded.

Before claiming a stable release:

- document the release tag and package artifact
- run `pnpm run verify`
- run `pnpm run conformance:run`
- update `docs/conformance/sdk-tier-evidence.md` with the result path and tier
  blockers

Breaking public API changes should change the major version. Additive generated
protocol support may change the minor version. Fixes that do not change the
public API may change the patch version.
