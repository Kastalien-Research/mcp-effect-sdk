# SDK Tier Evidence

## Current evidenced tier

Tier 3.

The SDK has generated protocol surfaces, core runtime checks, and an
Everything-style example server. `pnpm run verify` is the authoritative local
gate and includes the complete official MCP `2026-07-28` server/client suites,
the focused client-auth suite, and package-health checks. This is not itself a
Tier 2, Tier 1, or production-readiness claim: those remain blocked until the
complete official suites pass and release provenance, maintenance evidence,
richer docs, and the tracked draft follow-up issues have supporting artifacts.

### Blocking requirement status

`pnpm run check:sdk-readiness` currently reports 12 of the 14 blocking
requirements passing. The two that do not are the two that cannot be closed by
writing code:

| Requirement   | State  | Why                                                                                                                                                                                                                                                                                                                             |
| ------------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GR-TIER-002` | `fail` | Eight issues are in scope and none has been addressed: median first response 32.8 days, earliest SEP-1730 relegation date 2026-08-23. `pnpm run generate:tier-maintenance` records this from real `gh` history; `pnpm run check:tier-relegation` surfaces the deadline offline on every verify. Triaging the backlog clears it. |
| `GR-REL-001`  | `fail` | There is no stable release: no tag, no changelog, no published artifact, and the package is unpublished on npm. `pnpm run generate:release-provenance` reports exactly what is outstanding and refuses to write evidence until a maintainer cuts the release.                                                                   |

`GR-CONF-001` passes by adjudication, not by a clean run: three checks in the
pinned evaluator contradict the pinned normative schema. See
[`alpha9-external-contradictions.md`](alpha9-external-contradictions.md) and
[`conformance-blockers.json`](conformance-blockers.json). The adjudication is
pinned to the harness version and backed by executable reproducers, so it
expires on its own when the harness is upgraded.

The maintenance SLA's effective date was moved from 2026-07-17 to 2026-06-23 so
that the measurement window covers the repository's complete public issue
history. The earlier date sat after every existing issue, so the ledger excluded
the only data there was and reported "no evidence" while eight issues sat
untriaged — a reading more favourable than the criterion it encodes. See
[`../../MAINTENANCE.md`](../../MAINTENANCE.md).

`GR-AGENT-001`, `GR-AGENT-002`, and `GR-AGENT-003` are evidenced by real
agent-in-the-loop runs against `examples/agent-facing-proof-servers.ts` on two
models, three trials each, with named gaps recorded rather than suppressed. See
[`../agent-evidence/README.md`](../agent-evidence/README.md).

Local WP5 implementation is not remote issue closure. It is also not MCP
conformance qualification, release evidence, or Tier evidence.

## Reproducible command

```bash
pnpm run verify
pnpm run conformance:run
pnpm run conformance:client
pnpm run conformance:client-auth
pnpm run conformance:authorization
```

The official conformance CLI is installed through the private in-repo
`test/conformance` package. Historical `@modelcontextprotocol/conformance@0.1.x`
is not draft-authoritative for MCP `2026-07-28`; this package pins the
draft-targeted `0.2.x` line for MCP qualification evidence.

A fresh checkout should only need:

```bash
pnpm install --frozen-lockfile
pnpm run verify
```

`pnpm run e2e:draft` writes generated readiness evidence to
`.local/readiness-evidence/draft-e2e.json` by default, and `pnpm run verify`
writes `.local/readiness-evidence/e2e.json`. These are package-health artifacts,
not MCP conformance qualification. `pnpm run conformance:run` writes official
server evidence to `.local/readiness-evidence/conformance.json`, while
`pnpm run conformance:client` writes runtime-specific official client evidence
under `.local/readiness-evidence/conformance-client-node-*.json`. Set
`MCP_READINESS_EVIDENCE_DIR` to send readiness evidence reports to a CI-uploaded
directory. These generated reports are local/CI artifact state; they are not
committed source-of-truth documentation.

`pnpm run check:tier-protocol-features` writes protocol-feature freshness
evidence to `.local/readiness-evidence/tier-protocol-features.json`. That report
compares the generated protocol/schema surfaces with the vendored draft schema
metadata, records protocol version plus feature identifiers, and accounts for
removed, MRTR-replaced, or extension-gated `2025-11-25` concepts.

## Source inputs

- `sources/vendor/sep-1730/1730-sdks-tiering-system.md`
- `test/conformance/package.json`
- `examples/everything-server.ts`
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

MCP qualification conformance paths:

- Commands: `pnpm run conformance:run` and `pnpm run conformance:client`
- Package: `@modelcontextprotocol/conformance@0.2.x`
- Suite: `all`
- Spec version: `2026-07-28`
- Inventory authority:
  `conformance list --server|--client --spec-version 2026-07-28`
- Readiness evidence: `.local/readiness-evidence/conformance.json` and
  `.local/readiness-evidence/conformance-client-node-*.json`

Tier/readiness conformance remains blocked until both complete commands pass.

Draft client/auth conformance paths:

- `pnpm run conformance:client-auth` retains
  `conformance client --suite auth --spec-version 2026-07-28` for focused
  diagnosis. It is not a substitute for the authoritative `--suite all` client
  command.
- `pnpm run conformance:authorization` runs
  `conformance authorization --spec-version 2026-07-28` when #20 supplies either
  `MCP_AUTHORIZATION_CONFORMANCE_FILE` or `MCP_AUTHORIZATION_CONFORMANCE_URL`
  plus any required client credentials. Without that target it records a
  missing-target blocker artifact instead of pretending authorization
  conformance is complete.

Latest local client-auth draft conformance snapshot, captured on 2026-07-18:

| Command                            | Package/spec                                                    | Result                                                                                                                                                                                                                                        | Artifact                                                                                                                               |
| ---------------------------------- | --------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm run conformance:client-auth` | `@modelcontextprotocol/conformance@0.2.0-alpha.9`, `2026-07-28` | Exit 1: 14 scenarios, 225 passed, 12 failed, 1 warning. The 12 failures are the known SEP-837 DCR `application_type` gap; the warning is the SEP-2350 scope-union gap. This remains #20 work and is not package-health or readiness evidence. | `.local/conformance/client-auth-2026-07-18T23-59-04-442Z`; readiness summary `.local/readiness-evidence/conformance-client-auth.json`. |

Historical server and authorization snapshots captured on 2026-06-27 before the
alpha.9 pin remain blockers, not current qualification evidence:

| Command                              | Package/spec                                                    | Result                                                                                                                                                                                                                 | Artifact                                                                                                             |
| ------------------------------------ | --------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| `pnpm run conformance:run`           | `@modelcontextprotocol/conformance@0.2.0-alpha.7`, `2026-07-28` | Exit 1: 19 scenarios, 73 checks, 34 failures, 11 warnings. Blocked by stateless `_meta`/HTTP header validation, MRTR/InputRequiredResult, and `subscriptions/listen` streaming gaps tracked by #13, #14, #17, and #19. | `.local/conformance/draft-2026-06-27T20-05-35-387Z`; readiness summary `.local/readiness-evidence/conformance.json`. |
| `pnpm run conformance:authorization` | `@modelcontextprotocol/conformance@0.2.0-alpha.7`, `2026-07-28` | Exit 1 before running scenarios because no authorization server/settings target was supplied. This is the explicit #20 coordination point, not readiness evidence.                                                     | `.local/readiness-evidence/conformance-authorization.json`.                                                          |

Extension behavior is excluded from core conformance evidence. Extension
capabilities are disabled by default and are governed by `docs/extensions.md`
and `pnpm run check:extensions`.

Open issue accounting distinguishes local implementation from later profiles:

- #13 MRTR input-required retry flows: implemented locally in WP5F; remote
  disposition remains approval-gated.
- #14 scoped `subscriptions/listen`: implemented locally in WP5G; remote
  disposition remains approval-gated.
- #15 `io.modelcontextprotocol/tasks` extension: deferred to WP7.
- #17 Stateless Streamable HTTP negative paths: implemented locally in WP4;
  remote disposition remains approval-gated.
- #19 public-modern examples beyond Everything: implemented locally in WP5H;
  remote disposition remains approval-gated.
- #20 Draft authorization hardening: implemented locally in WP6; external
  authorization-server qualification and remote disposition remain
  approval-gated.

Current example build state:

- Built through published entrypoint owners: Everything server/client, core
  protocol catalog, and agent-facing proof servers. The catalog includes stable
  form Elicitation/MRTR and scoped Subscription usage.
- Excluded: `src/McpTasks.ts` and `examples/task-heavy/**`, both tracked by #15
  because tasks moved to the `io.modelcontextprotocol/tasks` extension.

## Tier blockers

- No published stable package release evidence.
- No passing draft-targeted official MCP conformance artifact, or exact
  upstream/tool blocker, has been recorded.
- Draft authorization conformance is wired but remains a #20 blocker until an
  authorization server/config target exists and passes.
- User documentation covers client and server usage, transports, authorization,
  errors, and current limitations in `docs/usage.md`, with coverage evidence at
  `.local/readiness-evidence/documentation-coverage.json`.
- No machine-readable Tier maintenance evidence artifact.
- No machine-readable agent-eval artifacts.
- Tasks (#15), authorization (#20), official conformance, and approval-gated
  issue disposition remain incomplete. Local implementation evidence for
  #13/#14/#17/#19 does not remove those separate blockers.

Passing local WP6 tests, package-health `verify`, self-hosted E2E, or official
client-auth does not establish external authorization-server conformance,
release readiness, Tier qualification, or #20 closure.

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
