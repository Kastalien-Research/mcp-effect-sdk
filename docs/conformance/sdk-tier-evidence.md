# SDK Tier 1 Self-Assessment Evidence

This repository targets self-assessed Tier-1-ready status for the released MCP
`2026-07-28` specification. It does not claim an SDK Working Group designation
or an npm publication that has not occurred.

The authoritative criteria are the
[published SDK tier policy](https://modelcontextprotocol.io/community/sdk-tiers)
and the
[official SDK tier audit](https://github.com/modelcontextprotocol/conformance/tree/main/.claude/skills/mcp-sdk-tier-audit).
Historical SEP text and release-candidate notes are context, not qualification
authority.

## Qualification command

The canonical qualification job runs on Node 22:

```bash
pnpm install --frozen-lockfile --strict-peer-dependencies
pnpm run build
pnpm run verify:conformance
```

`verify:conformance` runs all three required lanes:

- server `--suite all`;
- client `--suite all`; and
- client `--suite auth`.

Each lane records the exact Git commit, released spec version, conformance
package and source revisions, Node and pnpm runtime, complete scenario
inventory, and check results. The final
`.local/readiness-evidence/conformance-composite.json` is published only when
all three reports share that authority and pass 100% of applicable checks.
Skipped checks are accepted only when the official harness itself marks them
`SKIPPED`; they remain visible as `upstream-declared-skipped-informational`
exclusions. There is no local failure allowlist or adjudication ledger.

The separate `pnpm run conformance:authorization` command is diagnostic and
nonblocking. This package implements OAuth client and protected-resource roles;
it does not claim an authorization-server implementation.

## Coverage and documentation

[`feature-coverage.json`](feature-coverage.json) maps every supported
non-experimental method, notification, capability, transport, authorization
requirement, and retained deprecated boundary to:

- its public API owner;
- a published documentation anchor;
- an active example; and
- at least one test.

`pnpm run generate:docs-coverage` derives the required protocol and capability
sets from the pinned final schema and generated descriptors, then rejects any
missing or extra matrix row. Experimental capability fields are the only
policy-classified completeness exclusions.

Extension behavior is excluded from core conformance evidence. Extension
surfaces remain explicit, opt-in boundaries with their own tests and
documentation.

## Maintenance evidence

The Tier 1 maintenance evidence separates two records:

- the committed all-history ledger, which preserves every issue's creation to
  first-label timeline and every P0 label to closure timeline; and
- the rolling official audit window, generated from trusted GitHub issue
  timeline events.

The targets are first label within two business days and P0 closure within seven
calendar days of the first `P0` label. See
[`MAINTENANCE.md`](../../MAINTENANCE.md) and
[`sla-all-history.json`](../maintenance/sla-all-history.json). The derived
[`sla-ledger.json`](../maintenance/sla-ledger.json) currently records 1/9
on-time first labels (11.1%) in its 90-day window, so maintenance is an explicit
Tier 1 blocker until the official rolling score reaches at least 90%.

## Release status

The stable-release and provenance gate is intentionally fail-closed. A prepared
`1.0.0` changelog section or release workflow is not publication evidence.
Tier-ready status remains blocked until the package version, `v*` tag, tag
commit, GitHub Release, packed consumer checks, registry artifact, and
provenance report agree.

The implementation work that preceded the final specification is recorded
honestly in [`release-candidate-history.md`](release-candidate-history.md).
Those commits show release-candidate history; they do not substitute for
final-source, same-commit conformance or publication evidence.

## Supporting commands

```bash
pnpm run verify
pnpm run e2e:2026-07-28
pnpm run generate:docs-coverage
pnpm run generate:tier-maintenance
pnpm run check:tier-operations
pnpm run check:sdk-readiness
```

The self-hosted `e2e:2026-07-28` and package-health suites are valuable
regression evidence but do not replace the official conformance composite.
