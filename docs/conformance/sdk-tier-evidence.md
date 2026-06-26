# SDK Tier Evidence

## Current evidenced tier

Tier 3.

The SDK has generated protocol surfaces, task runtime checks, and an
Everything-style example server. `pnpm run verify` is the package-health gate
and includes the self-hosted MCP `2026-07-28` draft E2E scenarios. This is not
a Tier 2, Tier 1, full conformance, or production-readiness claim: those remain
blocked until draft-targeted official MCP conformance, release provenance,
maintenance evidence, richer docs, and the tracked draft follow-up issues have
supporting artifacts.

## Reproducible command

```bash
pnpm run verify
pnpm run conformance:run
```

The official conformance CLI is installed through the private in-repo
`test/conformance` package. Historical `@modelcontextprotocol/conformance@0.1.x`
is not draft-authoritative for MCP `2026-07-28`; this package pins the
draft-targeted `0.2.x` line for MCP qualification evidence.

A fresh checkout should only need:

```bash
pnpm install --frozen-lockfile
pnpm run verify
pnpm run conformance:run
```

`pnpm run e2e:draft` writes generated readiness evidence to
`.local/readiness-evidence/draft-e2e.json` by default, and `pnpm run verify`
writes `.local/readiness-evidence/e2e.json`. These are package-health artifacts,
not MCP conformance qualification. `pnpm run conformance:run` writes official
conformance qualification evidence to `.local/readiness-evidence/conformance.json`.
Set
`MCP_READINESS_EVIDENCE_DIR` to send readiness evidence reports to a CI-uploaded
directory. These generated reports are local/CI artifact state; they are not
committed source-of-truth documentation.

`pnpm run check:tier-protocol-features` writes protocol-feature freshness
evidence to `.local/readiness-evidence/tier-protocol-features.json`. That
report compares the generated protocol/schema surfaces with the vendored draft
schema metadata, records protocol version plus feature identifiers, and accounts
for removed, MRTR-replaced, or extension-gated `2025-11-25` concepts.

## Source inputs

- `../modelcontextprotocol/seps/1730-sdks-tiering-system.md`
- `test/conformance/package.json`
- `src/examples/everything-server.ts`
- `docs/conformance/scenario-map.md`
- `docs/conformance/dependency-update-policy.md`
- `docs/conformance/versioning-policy.md`

## Conformance coverage

Current package-health E2E path:

- Command: `pnpm run e2e:draft`
- Suite: self-hosted MCP `2026-07-28` draft scenarios
- Scenario map: `docs/conformance/scenario-map.md`
- Readiness evidence shape: `.local/readiness-evidence/draft-e2e.json`

The active draft scenario runner must execute without a failure baseline. Any
active scenario failure fails the command.

MCP qualification conformance path:

- Command: `pnpm run conformance:run`
- Package: `@modelcontextprotocol/conformance@0.2.x`
- Default suite: `draft`
- Default spec version: `2026-07-28`
- Readiness evidence shape: `.local/readiness-evidence/conformance.json`

Tier/readiness conformance remains blocked until this command passes or records
an exact upstream/tool blocker artifact.

Extension behavior is excluded from core conformance evidence. Extension
capabilities are disabled by default and are governed by `docs/extensions.md`
and `pnpm run check:extensions`.

Open draft feature-completeness work is tracked by:

- #13 MRTR input-required retry flows.
- #14 Request-scoped `subscriptions/listen` streaming.
- #15 `io.modelcontextprotocol/tasks` extension.
- #17 Stateless Streamable HTTP negative paths.
- #18 Cache metadata and low-risk draft wins.
- #19 Re-authored examples beyond Everything.
- #20 Draft authorization hardening.

## Tier blockers

- No published stable package release evidence.
- No passing draft-targeted official MCP conformance artifact, or exact
  upstream/tool blocker, has been recorded.
- Documentation is basic and still being completed.
- No machine-readable Tier maintenance evidence artifact.
- No machine-readable agent-eval artifacts.
- Draft feature-completeness follow-ups remain tracked by #13, #14, #15, #17,
  #18, #19, and #20.

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
