# SDK Tier Evidence

## Current evidenced tier

Tier 3.

The SDK has generated protocol surfaces, task runtime checks, and an
Everything-style example server, but Phase 6 has not yet recorded a passing
conformance run. The README must not claim Tier 2, Tier 1, full conformance, or
production readiness until this file records the supporting results.

## Reproducible command

```bash
pnpm run verify
pnpm run conformance:run
```

The conformance CLI is installed through the private in-repo
`test/conformance` package. A fresh checkout should only need:

```bash
pnpm install --frozen-lockfile
pnpm run conformance:run
```

Each `pnpm run conformance:run` execution writes MCP conformance artifacts under
`.local/conformance/<suite>-<timestamp>` by default. Set
`MCP_CONFORMANCE_OUTPUT_DIR` to send those artifacts to a CI-uploaded directory.
The artifact directory contains one scenario directory per conformance scenario,
with the MCP CLI's `checks.json` result for each scenario.

The same command also writes generated readiness evidence to
`.local/readiness-evidence/conformance.json` by default. Set
`MCP_READINESS_EVIDENCE_DIR` to send the readiness evidence report to a
CI-uploaded directory. This generated report is local/CI artifact state; it is
not committed source-of-truth documentation.

`pnpm run check:tier-protocol-features` writes protocol-feature freshness
evidence to `.local/readiness-evidence/tier-protocol-features.json`. That
report compares the generated protocol/schema surfaces with the vendored stable
schema metadata and records protocol version plus feature identifiers.

## Source inputs

- `../modelcontextprotocol/seps/1730-sdks-tiering-system.md`
- `test/conformance/package.json`
- `src/examples/everything-server.ts`
- `docs/conformance/scenario-map.md`
- `docs/conformance/dependency-update-policy.md`
- `docs/conformance/versioning-policy.md`

## Conformance coverage

Latest local recovery run:

- Command: `pnpm run conformance:run`
- Date: 2026-05-12
- Suite: active server scenarios
- Artifact shape: `.local/conformance/<suite>-<timestamp>/*/checks.json`
- Readiness evidence shape: `.local/readiness-evidence/conformance.json`
- Result: 40 checks passed, 0 checks failed across 30 active scenarios.

The conformance runner must execute without a failure baseline. Any active
scenario failure fails the command.

Extension behavior is excluded from core conformance evidence. Extension
capabilities are disabled by default and are governed by `docs/extensions.md`
and `pnpm run check:extensions`.

## Tier blockers

- No published stable package release evidence.
- Documentation is basic and still being completed.

## Tier 2 evidence requirements

- At least 80 percent conformance coverage.
- At least one stable release.
- Basic documentation covering core features.
- Published dependency update policy.
- Roadmap toward Tier 1 or transparent Tier 2 direction.

## Tier 1 evidence requirements

- 100 percent conformance coverage.
- Full protocol support.
- Stable release and versioning policy.
- Examples for all features.
- Published dependency update policy.
