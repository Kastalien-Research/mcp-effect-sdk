# Handoff — 2026-07-30 overnight Tier-1 hardening run

## What this session did

Autonomous overnight run (authorized) to drive the SDK to self-assessed MCP
Tier-1 readiness against the released `2026-07-28` specification, excluding
real-world acts (npm publication, upstream submissions, maintenance-window
aging).

The previous session's ~271-file in-flight working tree was repaired, verified,
and committed as four coherent commits on `feat/observability-spans`:

1. `feat: finalize the released 2026-07-28 protocol target with observability coverage`
2. `chore: align release governance, labels, and maintenance evidence`
3. `chore: migrate the effect-ts skill to the pinned upstream skills manager`
4. `chore: add the agent harness configuration`
5. this handoff commit

## Verified state (all independently re-run, not agent-graded)

- `pnpm run verify` — exit 0 at the committed state (every local gate:
  lint, foundation, invariants, generation, core, auth, observability,
  regressions, packaging, source-refresh, conformance evidence).
- Official conformance, Node 22, released spec `2026-07-28`, harness
  `@modelcontextprotocol/conformance@0.2.0-alpha.10` (registry-verified pin):
  - server `--suite all`: 40/40 scenarios, 0 failures, 0 warnings
  - client `--suite all`: 32/32 scenarios, 979 checks, 0 failures,
    2 upstream-declared informational skips
  - client `--suite auth`: 14/14 scenarios, 598 checks, 0 failures
  - same-commit composite: `.local/readiness-evidence/conformance-composite.json`
    (regenerate with `pnpm run verify:conformance` on Node 22 if absent —
    `.local/` is not committed)

## Remaining Tier-1 blockers — all out of scope for this run (real-world acts)

- **GR-REL-001 (publication)**: fail-closed by design. No `v1.0.0` tag, GitHub
  Release, or npm artifact exists yet. Cut the release via
  `pnpm run release` / release.yml when ready.
- **GR-TIER-002 (maintenance SLA)**: the rolling 90-day triage score is 1/9
  (11%, threshold 90%) from real June-2026 issue-history misses. This ages out
  only with on-time triage of future issues; nothing local can honestly fix it.
- Upstream/WG submissions: explicitly excluded by the operator.

## Notable defects fixed this run (root causes, for future archaeology)

- The runScript refactor orphaned module-scope helpers from `Effect.sync`
  closure state in `scripts/generate-mcp.mjs` and
  `scripts/generate-docs-coverage.mjs` (ReferenceErrors, one latent).
- Five scripts imported nonexistent `effect/NodeRuntime` (correct:
  `@effect/platform-node/NodeRuntime`).
- `scripts/generate-conformance-composite.mjs` pinned an npm integrity hash
  with a one-character typo (`XcFZ` vs registry `XcPZ`).
- Generation tests staged `generate-mcp.mjs` into temp fixtures without its
  new `scripts/lib/` dependency.
- `examples/tsconfig.json` lost its quarantine `exclude` accidentally
  (restored; task-heavy/typescript-sdk-ports stay quarantined per #15/#35).
- `StdioServerTransport` fired `closeSubscriptions` on every exit path,
  breaking the fail-closed "malformed input produces zero further output"
  invariant (now success-only via `Effect.onExit`).
- Script-entrypoint contract tests gained a documented three-script exemption
  set (tarball-shipped and isolated-workspace scripts that cannot import
  effect; see `SCRIPT_ENTRYPOINT_EXEMPTIONS`).

## Next actions for a human

1. Review and merge `feat/observability-spans` (branch verify + CI should be
   green; conformance composite regenerates on Node 22).
2. Decide when to cut `v1.0.0` (unblocks GR-REL-001).
3. Keep issue triage inside two business days so GR-TIER-002's rolling window
   recovers by ~late September 2026.
