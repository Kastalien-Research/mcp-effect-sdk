# Parallel Subagent Integration

When fanning implementation work across parallel subagents in ONE shared
worktree (observed working, 2026-07-17: five-agent dispatch phase-1 fan-out —
zero file conflicts, 111/111 green at integration):

- **Disjoint file ownership, declared up front.** Every shared artifact has
  exactly one owner; all other agents code against the DECLARED contract (column
  names, exported signatures) — not the file. Name the contract explicitly in
  every brief that touches it.
- **Agents never commit.** The orchestrator integrates, commits, pushes.
- **Reports carry raw measurements only** (test counts, typecheck output
  verbatim) — and the orchestrator RE-RUNS the verification itself before
  accepting any of it. No-self-graded-verification applies to subagents exactly
  as it does to workflow steps: both integration defects of 2026-07-17 hid
  behind confident green reports.
- **Cross-read reports for contract drift** (the cursor-table divergence was
  visible only by comparing two agents' reports); route the fix to the
  artifact's OWNER via mailbox — idle agents resume with full context and fix
  their own files cheaply.
- **Mid-flight interface changes: additive only, and message dependents
  immediately.** An agent can finish before reading its mailbox — verify the
  wiring exists by grepping the code, never by the report alone.

## Proven extensions (2026-07-18/19: 13 agents, two OVERLAPPING waves, zero conflicts)

- **Contracts doc before any fan-out.** Pin every cross-agent interface (tags,
  signatures, table shapes, env names, wire formats) in a single probe-verified
  document (`docs/headless-v1-contracts.md` pattern) and cite it in every brief.
  Agents code against the DOC, never each other's files — this is what let a
  code wave and an infra wave run concurrently without collisions.
- **Reuse an EXECUTABLE artifact as the acceptance spec when porting a
  harness.** The headless runner reproduced the interactive Workflow semantics
  on FIRST integration (byte-identical pass list) because the existing mock test
  was the spec, extracted into a shared module both harnesses consume
  (`.claude/workflows/tests/mock-agent.cjs`). Prose specs drift; executable
  specs can't.
- **Type-fix the fast lane.** vitest (esbuild) strips types — an agent's "suite
  green" does not imply `tsc` clean. The integration gate must run
  `npm run typecheck` with a REAL exit-code check, not a tail of output.
