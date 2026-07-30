# MCP `2026-07-28` Scenario Map

`scripts/run-2026-07-28-e2e.mjs` is the released-spec, self-hosted
package-health E2E lane. It exercises the built Everything server and client
without replacing official conformance qualification.

| Scenario          | SDK feature                                                        | Status | Evidence                                                                                                            |
| ----------------- | ------------------------------------------------------------------ | ------ | ------------------------------------------------------------------------------------------------------------------- |
| stable_e2e        | `server/discover`, list/read/get/call, and final protocol metadata | mapped | `pnpm run e2e:2026-07-28` runs `dist/examples/everything-client.js` with `MCP_CONFORMANCE_SCENARIO=stable_e2e`.     |
| stable_tools_call | Tool discovery and argument-bearing invocation                     | mapped | The same runner executes `MCP_CONFORMANCE_SCENARIO=stable_tools_call` against `dist/examples/everything-server.js`. |

Official qualification is a separate same-commit composite:

| Command                              | Scope                                | Spec target                              | Qualification role                                        |
| ------------------------------------ | ------------------------------------ | ---------------------------------------- | --------------------------------------------------------- |
| `pnpm run conformance:run`           | Complete applicable server inventory | `--suite all --spec-version 2026-07-28`  | Required composite component                              |
| `pnpm run conformance:client`        | Complete applicable client inventory | `--suite all --spec-version 2026-07-28`  | Required composite component                              |
| `pnpm run conformance:client-auth`   | OAuth client scenarios               | `--suite auth --spec-version 2026-07-28` | Required composite component                              |
| `pnpm run conformance:authorization` | Authorization-server implementation  | `--spec-version 2026-07-28`              | Nonblocking diagnostic; this SDK does not claim that role |

`pnpm run verify:conformance` runs the three required components and emits
`.local/readiness-evidence/conformance-composite.json` only when they share one
commit, spec, harness, runtime, and source authority and pass 100% of applicable
checks. Any official-harness `SKIPPED` check remains visible as an upstream
classified exclusion; local waivers are not accepted.

Active examples compiled into `dist/examples/**`:

| Example source                           | Protocol status                                                                  |
| ---------------------------------------- | -------------------------------------------------------------------------------- |
| `examples/everything-server.ts`          | Released-spec server and conformance target                                      |
| `examples/everything-client.ts`          | Released-spec E2E, client, and client-auth target                                |
| `examples/core-protocol-catalog.ts`      | Public-entrypoint catalog for MRTR, subscriptions, tools, resources, and prompts |
| `examples/agent-facing-proof-servers.ts` | Agent-affordance proof servers with explicit result metadata                     |

Experimental Tasks remain opt-in and outside core Tier completeness.
