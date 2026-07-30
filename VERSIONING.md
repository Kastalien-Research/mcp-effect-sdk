# Versioning Policy

`mcp-effect-sdk` follows Semantic Versioning for its public package entrypoints.

- A major release may remove or incompatibly change a public API, error type,
  encoded wire contract, or supported runtime.
- A minor release may add protocol features, exports, options, or compatible
  generated schema definitions.
- A patch release fixes behavior without intentionally changing the public API.

Breaking changes to a stable public entrypoint require a new major version and
must be called out in `CHANGELOG.md` with migration guidance.

Generated protocol names are public when exported by
`mcp-effect-sdk/protocol/2026-07-28`. The first GA is generated directly from
the final schema and intentionally carries no draft-era compatibility aliases.
After `1.0.0`, removing or renaming one of these exports requires a major
release unless the symbol was explicitly experimental.

Experimental extensions are exported from explicit `experimental/*` paths. Their
compatibility policy is documented with the extension and does not weaken the
stable core contract.

## Stable release evidence

The repository currently contains `1.0.0` release preparation, but this policy
does not claim that publication has occurred. A stable release is evidenced only
after all of the following agree:

- the package version and immutable Git tag;
- a non-prerelease GitHub Release;
- the published registry artifact and integrity;
- [CHANGELOG.md](CHANGELOG.md);
- server, client, and client-auth composite conformance evidence for the tagged
  commit; and
- a clean install and consumer test of the published artifact.

MCP SDK Tier designation is granted by the MCP SDK Working Group. A stable
release and a passing self-assessment are prerequisites, not a designation.
