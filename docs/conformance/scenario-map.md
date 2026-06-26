# Draft E2E Scenario Map

This package now treats `scripts/run-draft-e2e.mjs` as the active behavioral
acceptance path for the MCP `2026-07-28` stateless draft. The historical
external conformance suite still speaks the older initialize/session protocol
and is not used as draft-authoritative evidence.

| Scenario | SDK feature | Status | Evidence |
| --- | --- | --- | --- |
| draft-round-trip | Draft `server/discover`, list/read/get/call round trip | mapped | `scripts/run-draft-e2e.mjs` starts `dist/examples/everything-server.js` and runs `dist/examples/everything-client.js` with `MCP_CONFORMANCE_SCENARIO=draft-round-trip`. |
| tools-call | Draft tools list/call behavior | mapped | `scripts/run-draft-e2e.mjs` runs `MCP_CONFORMANCE_SCENARIO=tools-call` against the built Everything server. |

Pending draft scenarios are tracked by the open migration issues rather than by
the historical scenario IDs:

| Area | Tracking issue |
| --- | --- |
| MRTR input-required retry flows | #13 |
| Request-scoped `subscriptions/listen` streaming | #14 |
| `io.modelcontextprotocol/tasks` extension | #15 |
| Stateless Streamable HTTP negative paths | #17 |
| Cache metadata and low-risk draft wins | #18 |
| Re-authored examples beyond Everything | #19 |
| Draft authorization hardening | #20 |
