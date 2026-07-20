# Draft E2E Scenario Map

This package treats `scripts/run-draft-e2e.mjs` as local package-health E2E for
the MCP `2026-07-28` stateless draft. It is not a substitute for official MCP
conformance qualification: historical `@modelcontextprotocol/conformance@0.1.x`
is not draft-authoritative, while draft-targeted
`@modelcontextprotocol/conformance@0.2.x` is the required conformance path for
readiness/Tier claims.

| Scenario | SDK feature | Status | Evidence |
| --- | --- | --- | --- |
| draft-round-trip | Draft `server/discover`, list/read/get/call round trip | mapped | `scripts/run-draft-e2e.mjs` starts `dist/examples/everything-server.js` and runs `dist/examples/everything-client.js` with `MCP_CONFORMANCE_SCENARIO=draft-round-trip`. |
| tools-call | Draft tools list/call behavior | mapped | `scripts/run-draft-e2e.mjs` runs `MCP_CONFORMANCE_SCENARIO=tools-call` against the built Everything server. |

Local implementation and later profiles are tracked by the open migration
issues rather than by historical scenario IDs. Local WP5 implementation is not remote issue closure.

| Area | Tracking issue | Local implementation state |
| --- | --- | --- |
| MRTR input-required retry flows | #13 | Implemented locally in accepted WP5F evidence; issue disposition remains approval-gated. |
| Request-scoped `subscriptions/listen` streaming | #14 | Implemented locally in accepted WP5G evidence; issue disposition remains approval-gated. |
| `io.modelcontextprotocol/tasks` extension | #15 | Deferred to WP7. |
| Stateless Streamable HTTP negative paths | #17 | Implemented locally in accepted WP4 evidence; issue disposition remains approval-gated. |
| Re-authored examples beyond Everything | #19 | Implemented locally in WP5H; issue disposition remains approval-gated. |
| Draft authorization hardening | #20 | Implemented locally in WP6; external authorization-server qualification and issue disposition remain approval-gated. |

Official draft conformance commands:

| Command | Scope | Spec target | Current status |
| --- | --- | --- | --- |
| `pnpm run conformance:run` | Server conformance against `dist/examples/everything-server.js` | `--suite draft --spec-version 2026-07-28` | Draft qualification path. Passing this command, or recording its exact upstream/tool blocker artifact, is required for MCP conformance readiness. |
| `pnpm run conformance:client-auth` | Client auth conformance against `dist/examples/everything-client.js` | `--suite auth --spec-version 2026-07-28` | Separate from package-health `verify`; remaining auth behavior is coordinated with #20. |
| `pnpm run conformance:authorization` | Authorization server conformance | `--spec-version 2026-07-28` | Opt-in command for #20. It requires `MCP_AUTHORIZATION_CONFORMANCE_FILE` or `MCP_AUTHORIZATION_CONFORMANCE_URL` and records a missing-target blocker when no authorization server/config is supplied. |

This local `test:wp6`, `verify`, self-hosted draft E2E, and client-auth evidence
does not prove external authorization-server conformance, release readiness,
Tier qualification, or remote issue closure.

Active examples that compile into `dist/examples/**`:

| Example source | Protocol status |
| --- | --- |
| `src/examples/everything-server.ts` | Draft-aligned server conformance target. |
| `src/examples/everything-client.ts` | Draft-aligned local E2E and client/auth conformance target. |
| `src/examples/core-protocol-catalog.ts` | Draft-aligned public-entrypoint catalog using stable form Elicitation/MRTR and scoped `subscriptions/listen`; no initialize/session-era client calls. |
| `src/examples/agent-facing-proof-servers.ts` | Draft-aligned agent affordance proof servers with explicit result metadata. |

Still excluded:

| Excluded path | Tracking issue | Protocol reason |
| --- | --- | --- |
| `src/McpTasks.ts` | #15 | Core tasks left the draft protocol and must be re-authored as the opt-in `io.modelcontextprotocol/tasks` extension. |
| `src/examples/task-heavy/**` | #15 | These examples still model task-heavy core behavior; keep them excluded until the task extension exists. |
