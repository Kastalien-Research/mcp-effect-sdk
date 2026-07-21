# Goal Mode prompt: implement the MCP 2026-07-28 alignment plan

You are operating in:

`/Users/b.c.nims/dev/kastalien-research/effect-stuff/effect-mcp-sdk/mcp-effect-sdk`

Use Goal Mode for this work. If no matching unfinished Goal exists, create one with no token budget and this objective:

> Implement the complete Effect MCP SDK alignment plan: deliver an Effect 3-native, modern-only MCP `2026-07-28` implementation; independently gated experimental Tasks, stable MCP Apps, and Apps preview support; release-quality documentation and packaging; and verifiable Tier 1 readiness. Carry the work through `1.0.0-rc.1` technical readiness, then perform the bounded final-spec reconciliation when the official artifacts exist. Never publish, tag, submit a Tier application, or claim completion without satisfying the plan's evidence and approval gates.

If a matching Goal is already active, resume it from durable evidence instead of replacing or restarting it. Then execute the plan; do not merely analyze, summarize, or restate it.

## Read first

Read these completely before editing:

1. `AGENTS.md`
2. `docs/plans/2026-07-16-feat-align-mcp-draft-tier1-plan.md`
3. `ROADMAP.md`
4. `docs/draft-2026-07-28-migration.md`
5. `docs/conformance/scenario-map.md`
6. `docs/conformance/sdk-tier-evidence.md`
7. `docs/sdk-readiness-requirements.md`

Inspect the real Git root, branch, working tree, package/lockfile, CI, current evidence, open PR #27, and live issues #13-#20. Preserve all user work. The plan and this prompt may initially be untracked; retain them and make them durable in the first work package. Never reset, clean, overwrite, or discard unrelated changes.

Critically review the plan once before Task 1. If you find a genuine contradiction that prevents implementation, present all such conflicts together with the exact plan text and ask one batched question. Otherwise proceed without asking for confirmation.

## Execution model

- Treat the plan's pinned revisions, hashes, precedence rules, API decisions, scope boundaries, sequence, and acceptance criteria as the execution contract. Do not silently revise them or opportunistically adopt newer upstream changes during the frozen-draft work.
- Execute work packages 1-11 in order. A later package cannot compensate for a red required gate in an earlier package. Subdivide a package into smaller commits/tasks when needed, but do not collapse the migration into a monolithic change.
- Use an isolated worktree when safely available. Detect existing isolation first, prefer native worktree support, and preserve the untracked plan/prompt when moving into it.
- Use subagent-driven development. The coordinating agent owns the Goal, integration, ledger, and final truth. For each bounded task, use a fresh implementer that follows TDD, then a separate reviewer for both specification compliance and code quality. Resolve every Critical or Important finding and re-review before marking the task complete. Use one writer for overlapping files or dependent work; parallelize only independent read-only research, test audits, or non-overlapping work.
- Maintain `.superpowers/sdd/progress.md` as a durable recovery ledger and ensure it is ignored. Record each completed task's commit range, review verdict, exact commands/results, evidence paths, remaining risks, active branch/PR, and next task. After compaction or resume, trust the ledger, Git history, and live PR state; never re-dispatch completed work.
- Follow GitHub Flow with `codex/` branches, tests before or alongside behavior, small atomic commits, and one focused draft PR per work package. Base each phase on the prior landed phase; if approval is pending and continued work is safe, use explicitly stacked branches/PRs and document their dependencies.
- Push branches and open/update draft PRs. Give each PR an independent review, resolve actionable findings, run its cumulative gates, and report CI. Do not merge PRs autonomously.
- Leave PR #27 intact until work package 6 has ported its behavior and tests to the new architecture. Do not merge its obsolete API, close it, or call it superseded until equivalent evidence exists and I approve the disposition.
- Reconcile issues #13-#20 only through explicit implementation and evidence links. File overlap is not proof. Do not close or reclassify existing issues without approval.
- Make reversible, low-risk implementation decisions within the plan. Ask only when the answer would materially change scope, public API, security posture, package identity, release behavior, or an approval boundary. Do not ask whether to continue between ordinary tasks.
- Treat any user `HOLD` as a hard stop: do not retry, terminate, or reinterpret the held action. Never read, print, copy, or commit secrets or credential files.

## Baseline and verification

- Start on Node 22 with the repository-pinned pnpm via Corepack. Install with the frozen lockfile and run `env CI=true corepack pnpm run verify` before changes. If that package-health gate unexpectedly fails, diagnose it or ask before proceeding.
- Run and record the current official server/client-auth conformance baselines separately. Their known failures are work to eliminate, not proof that the package-health baseline is unusable. Never describe self-hosted E2E, historical evidence, or a green legacy `verify` as official qualification.
- After the Effect 3 foundation lands, add and retain Node 24 as a release lane. Compile against the lowest supported Node types and prove a single Effect runtime in packed consumers.
- Keep ordinary verification network-free and validate vendored source hashes. Network access is allowed only for explicit source refresh, live GitHub/registry checks, reference interoperability, or other plan-mandated external evidence.
- Pin `@modelcontextprotocol/conformance@0.2.0-alpha.9`. Every official server, client, and client-auth invocation must pass the literal `--spec-version 2026-07-28`; never rely on the harness default.
- Run every applicable modern core scenario with zero failures and no local expected-failure allowlist. Report upstream-declared skips but never count them as passes. Do not retain legacy scenarios as release gates.
- Keep core conformance, Tasks, Apps stable, Apps preview, release readiness, and official Tier designation as separate evidence claims. Extension results never inflate core Tier coverage.
- Run all prescribed unit, integration, E2E, authorization, browser/Playwright, reference-interoperability, Node 22/24, type/export, package-consumer, and release checks. Do not weaken schemas, disable tests, add expected-failure baselines, retain legacy APIs, or change pins merely to make failures disappear.
- After each work package run its focused and cumulative gates. Before declaring the RC technically ready, run `pnpm run verify:release` and the final `pnpm run verify` on the required runtime matrix.
- Preserve schema-validated machine-readable evidence containing exact commands, pinned revisions, runtime versions, cases/scenarios, exit codes, timestamps, and requirement IDs. A package or PR is not complete while required checks fail or remain unrun.

## Authorization and approval boundaries

You are authorized to:

- edit the repository and documentation;
- install the pinned production dependencies and justified development/test dependencies in the plan;
- run builds, tests, conformance, browser tests, package/install checks, and read-only external verification;
- create worktrees and `codex/` branches;
- create atomic commits, push branches, and open/update draft PRs;
- add the repository-local Tier policies, templates, automation, evidence tooling, and required labels defined by the plan.

Stop for explicit approval before:

- merging any PR;
- closing or materially reclassifying existing issues or PR #27;
- changing protected repository settings or performing destructive actions;
- creating a release tag or GitHub release;
- publishing `1.0.0-rc.1`, `1.0.0`, or any npm artifact;
- renaming the package if `mcp-effect-sdk` is unavailable or not owned;
- submitting the Tier 1 evidence request;
- adding a Tier 1 badge or public claim;
- performing unrelated external-infrastructure or cloud mutations.

Prepare `1.0.0-rc.1`, its packed-artifact verification, and provenance evidence, but do not publish it without approval.

At runtime, verify whether the official July 28 final schema and final conformance artifacts exist. If they do not, complete work packages 1-10 against the frozen RC snapshot, record the exact checkpoint, and leave work package 11 time-gated. Do not follow interim upstream drift. When final artifacts exist, implement only evidenced deltas in a separate work-package-11 PR and rerun the final official harness.

Never fabricate or backdate Tier maintenance evidence. Implement the policy and ledger now, but do not claim Tier 1 until the evidence supports the policy, I approve the application, and the MCP SDK Working Group grants the designation.

## Goal completion and communication

Track these milestones separately:

1. Frozen-draft implementation complete.
2. `1.0.0-rc.1` technically ready and awaiting publication approval.
3. Final `2026-07-28` delta reconciled and stable `1.0.0` ready.
4. Approved stable release published and public tarball verified.
5. Tier evidence eligible, approved for submission, submitted, and accepted by the SDK Working Group.

Do not mark the Goal complete merely because code is written, draft PRs exist, one PR is merged, local `pnpm pack` succeeds, or the RC is ready. Mark it complete only when every applicable implementation and verification gate has passed, all repository work is landed or explicitly accepted in reviewable PRs, the final reconciliation has passed, approved releases have actually been published and verified, and the approved Tier application has received Working Group designation.

If waiting on PR/merge approval, final artifacts, publication approval, maintenance history, or Working Group action, report the exact milestone and continuation state without claiming overall completion. Use Goal Mode's blocked status only according to its repeated-blocker rules; never mark complete to escape an external wait.

At substantive checkpoints, report only: completed work package(s), branch/PR/commits, exact verification evidence, review findings and their resolution, remaining risks/blockers, and the next action. Keep progress updates concise. At the end of each coding session follow `AGENTS.md`, including what changed, files, verification, commits, surprising positive/negative outcomes, environment improvements, and remaining risks.
