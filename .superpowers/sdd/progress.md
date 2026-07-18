# MCP 2026-07-28 alignment progress

## Active state

- Goal: active; no token budget.
- Branch: `codex/wp4-wire-kernel-transports`.
- Worktree: `/private/tmp/mcp-effect-sdk-wp4`.
- Base/dependency: accepted WP3 head `36a2203690494e73deaa144d02ad70e7d2576afd`, stacked draft PR #30; WP4 must remain explicitly stacked and must not merge.
- Active work package: 4 of 11, replace the wire kernel and transports.
- Active bounded task: 4C, modern stdio client/server framing and process
  lifecycle, starting from accepted Task 4B head `2d611768`.
- PR: not opened yet.
- Next: independent read-only Task 4C review, then coordinator exact-head full
  verification before acceptance.

## Completed work packages

- WP1: independently approved; draft PR #28; CI green.
- WP2: independently approved; stacked draft PR #29; Node 22/24 CI green.
- WP3: exact accepted head `36a2203`; independently approved; stacked draft PR #30; Node 22/24 CI green.

## WP4 locked acceptance

- Exact JSON-RPC serialization with string/integer IDs preserved and invalid/null/fractional IDs rejected.
- SDK-owned dispatcher, typed errors, and request-scoped response streams.
- Modern stdio and stateless POST-only Streamable HTTP transports with required metadata, validation, JSON/SSE framing, cancellation, and bounded header mismatch recovery.
- Remove session, legacy HTTP+SSE, WebSocket, GET/delete/resume, and published legacy transport paths.
- Preserve generated protocol authority and Effect 3 foundation; do not implement WP5 feature behavior early.

## Current risks

- Task 4A replaced coercive ID handling and the empty notification sentinel;
  the compatibility serializer still retains legacy framing until Tasks 4C/4D.
- Existing `HttpTransport` retains mutable session state and `MCP-Session-Id` behavior despite the draft being stateless.
- Legacy SSE and WebSocket transports remain exported from the root.
- Current server behavior is concentrated in `McpServer.ts`; the dispatcher replacement must preserve working feature handlers without turning transport state into protocol state.

## Task 4A implementation evidence

- RED: `20bd693`, 10/10 expected runtime failures plus failing public type fixture.
- GREEN: `d15c2a9`; compatibility invariant adjustment: `42208cc`.
- Node 22 focused: 10/10 plus type fixture.
- Compatibility: Task 3A 28/28, Task 3B 14/14, WP2 16/16; source,
  generated, schema, type, unit, and integration gates pass.
- Full escalated `pnpm run verify`: exit 0; `draft-round-trip` and `tools-call`
  both pass. The unprivileged attempt failed only on sandbox localhost `EPERM`.
- Review cycle RED: `dcc7a05` exposed exactly four Important regressions;
  `da50b0d` added two related public-surface regressions before production.
- Review cycle GREEN: `07bb02c`; Node 22 focused 16/16 plus type fixture, all
  cumulative compatibility gates, and full escalated verify pass.
- Second review RED: `0c5b18c`, prior 16 green and exactly two accessor
  projection regressions failing. GREEN: `26f04b7`, focused 18/18 plus type
  fixture and full escalated verification pass.
- Final Task 4A report head: `49eb636`; independent rereview approved with no
  Critical, Important, or Minor findings. Coordinator-owned exact-head Node 22
  `pnpm run verify` passed, including both draft E2E scenarios.

## Task 4B implementation evidence

- RED sequence: `b3161b8`, `36e40c9`, `0ed3963`, `6cc4dd9`, `37f8403`, and
  `cf1ddd6`; each production behavior was preceded by a focused failing probe.
- GREEN sequence: `788213c` and final fix `1944c21`.
- Node 22 focused after review fixes: runtime 20/20 plus public type fixture.
- Full escalated `pnpm run verify`: exit 0; `draft-round-trip` and `tools-call`
  both pass. The restricted attempt failed only on sandbox localhost `EPERM`.
- Review RED/fix sequence: `ad3ccfb`, `cf263bf`, `ab2c49f`, `d005bb0`, and
  `985f230`; final report head `2d611768`.
- Independent rereview approved with no Critical, Important, or Minor findings.
  Coordinator-owned exact-head Node 22 `pnpm run verify` passed, including both
  draft E2E scenarios. Task 4B is accepted.
- Report: `.superpowers/sdd/task-4b-report.md`.

## Task 4C implementation evidence

- RED/GREEN sequence: `6e8ee27` through implementation head `3ee3e1a`; every
  production behavior was preceded by a focused failing probe.
- Node 22 focused: runtime 16/16 plus public type fixture; WP2 16/16.
- Full escalated `pnpm run verify`: exit 0; `draft-round-trip` and `tools-call`
  both pass. The restricted attempt failed only on sandbox localhost `EPERM`.
- Shared stdio kernel, dispatcher-native client/server, bounded process queues,
  supervised lifecycle, and strict generated-result normalization are active.
- Report: `.superpowers/sdd/task-4c-report.md`.
