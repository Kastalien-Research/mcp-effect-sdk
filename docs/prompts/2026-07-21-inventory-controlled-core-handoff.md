# Inventory-Controlled Core Closure Handoff

Start the next chat with:

`[$complete-inventory-control-loop](/Users/b.c.nims/.codex/skills/complete-inventory-control-loop/SKILL.md)`

Read that skill and both bundled references before any mutation. Use this handoff
as the single control-loop ledger. It supersedes
`docs/prompts/2026-07-21-tier1-readiness-handoff.md`, whose progress status and
full-inventory status are now stale.

## Authority and checkout

- Repository: `/private/tmp/mcp-effect-sdk-wp6`
- Branch: `codex/wp6-authorization`
- HEAD before this handoff commit: `23a9e3b`
- Worktree before this handoff: clean
- Governing specification: pinned MCP `2026-07-28` draft snapshot
- Authoritative harness: `@modelcontextprotocol/conformance@0.2.0-alpha.9`
- Authoritative inventories:
  - `pnpm --dir test/conformance exec conformance list --server --spec-version 2026-07-28`
  - `pnpm --dir test/conformance exec conformance list --client --spec-version 2026-07-28`
- Frozen inventory: 40 server scenarios and 32 client scenarios
- Required runtime matrix: Node `v22.22.3` and Node `v24.15.0`, pnpm `10.11.1`

The complete official inventories are authoritative. Focused scenarios, local
tests, assertion counts, and reviews are diagnostic evidence only.

## Control-loop state

Current state: `RECONCILING`, with no observed local core failure in the latest
complete Node 22 or Node 24 inventories. Do not advance to `EXTERNALLY_BLOCKED`
until the four residual checks have exact deterministic reproducers. Do not
advance to `CLOSED` while the official commands exit nonzero or the remaining
core gates are unrun.

Next single executable action: add and run the three deterministic
spec-versus-harness/dependency reproducer clusters described below, plus the
concise blocker document. Make no production compatibility change for them.

## Accepted progress repair

`23a9e3b fix: encode progress notifications at HTTP boundary`

The regression now enters through the public tool registration and
`McpServer.sendProgress`, reaches the HTTP/SSE transport boundary, and validates
the encoded wire notification. The production fix schema-encodes known
notification params before strict wire encoding.

Observed verification:

- Clean rebuild followed by the focused public-boundary test first reproduced
  `HTTP response stream failed`.
- After the fix, the focused test passed.
- `node --test test/http/wp4-http-server.test.mjs`: 61/61 passed.
- Official `tools-call-with-progress`: success, with three increasing progress
  notifications at 0, 50, and 100 using the matching token.
- Both later complete server inventories contain that scenario as successful.

Do not reopen or reimplement progress without new failing evidence.

## Latest complete authoritative artifacts

| Runtime | Lane | Artifact | Scenarios | Checks | Failures | Warnings | Skips | Exit |
| --- | --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Node 22.22.3 | server | `.local/conformance/all-2026-07-21T02-42-31-075Z/evidence.json` | 40 | 115 | 3 | 0 | 0 | 1 |
| Node 22.22.3 | client | `.local/conformance/client-all-2026-07-21T02-43-05-306Z/evidence.json` | 32 | 978 | 1 | 0 | 2 | 1 |
| Node 24.15.0 | server | `.local/conformance/all-2026-07-21T02-43-47-708Z/evidence.json` | 40 | 115 | 3 | 0 | 0 | 1 |
| Node 24.15.0 | client | `.local/conformance/client-all-2026-07-21T02-44-42-143Z/evidence.json` | 32 | 978 | 1 | 0 | 2 | 1 |

The runtime results are identical. The two client skips are upstream-declared
informational skips for removed `initialize` and `notifications/initialized`
header checks. They are not our passes.

## Closed residual failure map

Every latest non-success result is assigned exactly once:

### Cluster 1: optional client info promoted to required

Server checks:

- `sep-2575-request-meta-invalid-missing-client-info`
- `sep-2575-http-server-meta-invalid-400`

The pinned `RequestMetaObject` makes
`io.modelcontextprotocol/clientInfo` optional and says clients SHOULD include
it. Alpha.9 omits it but expects JSON-RPC `-32602` and HTTP 400. The
spec-conforming server accepts it and returns 200. One contradiction produces
two failed checks.

### Cluster 2: server info checked at the wrong discover location

Server check:

- `sep-2575-server-implements-discover`

The pinned specification defines optional server identity at
`result._meta["io.modelcontextprotocol/serverInfo"]`. `DiscoverResult` has no
top-level `serverInfo`. Alpha.9 checks `result.serverInfo` and reports a missing
mandatory field even when the specified `_meta` field is present.

### Cluster 3: client `$ref` scenario cannot negotiate its advertised version

Client check:

- `sep-2106-no-network-ref-deref`

Alpha.9 advertises MCP `2026-07-28` in `json-schema-ref-no-deref`, but its
embedded `@modelcontextprotocol/sdk@1.29.0` supports only through `2025-11-25`.
Negotiation fails before the client can call `tools/list`, so the harness never
reaches the network-`$ref` behavior it claims to evaluate.

Required contradiction artifacts:

- exact deterministic reproducer clusters under `test/conformance/`;
- one concise blocker document under `docs/conformance/`;
- responsible package versions, exact expectation, governing spec behavior,
  evidence paths, and unblock conditions;
- no harness-name checks, duplicate compatibility fields, protocol downgrade,
  expected-failure allowlist, or version lie.

## Required sequence after the reproducers

1. Commit the contradiction reproducers and blocker document atomically.
2. Perform one independent core review over `f3605f5..HEAD`; inspect and rerun
   accepted findings from this checkout rather than accepting a review summary.
3. Run `pnpm run verify` under Node 22 and Node 24. It includes the complete
   official lanes and is expected to exit nonzero while the external
   contradictions remain; report the exact terminal results rather than
   relabeling the gate green.
4. Rerun the complete server/client inventories if any source, harness,
   dependency, or generated output changes. Reconcile enumerated IDs against
   artifact IDs exactly.
5. Update `.superpowers/sdd/progress.md` and the conformance evidence docs with
   the final artifacts, exact residuals, and blocker disposition.
6. Continue to WP7 Tasks, WP8 Apps server/View, WP9 Apps Host/preview, WP10
   release-candidate qualification, and WP11 final reconciliation.

## Commands

Node 22:

```bash
export PATH=/Users/b.c.nims/.nvm/versions/node/v22.22.3/bin:$PATH
node --version
pnpm --version
pnpm run build
pnpm run conformance:run
pnpm run conformance:client
pnpm run verify
```

Node 24:

```bash
export PATH=/Users/b.c.nims/.nvm/versions/node/v24.15.0/bin:$PATH
node --version
pnpm --version
pnpm run build
pnpm run conformance:run
pnpm run conformance:client
pnpm run verify
```

## Approval and claim boundaries

- Do not merge, publish, tag, close or reclassify remote issues, or mutate
  external authorization infrastructure without the required user approval.
- External authorization-server qualification remains approval-gated.
- Do not claim MCP Tier readiness or designation before final-spec
  reconciliation, complete official evidence, publication approval, and MCP
  SDK Working Group designation.
- Do not let further tooling, reviews, or process work displace the next
  authoritative gate action.
