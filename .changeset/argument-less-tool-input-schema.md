---
"mcp-effect-sdk": patch
---

Fix the input schema advertised for argument-less tools.

A tool registered via `McpServer.registerTool` without `parameters` advertised
an input schema built from Effect's empty struct, which renders as
`anyOf: [{type:"object"},{type:"array"}]` with a synthetic `$id`. Spreading
`type: "object"` over that left a top-level `anyOf` in place.

Several LLM providers reject a tool whose input schema has a top-level `anyOf`,
and they reject the **entire request** rather than the single tool — so one
argument-less tool made a whole server unusable to those clients. Such a tool
now advertises `{"type":"object","properties":{},"additionalProperties":false}`.

Tools declared with `parameters` or a complete `parameterSchema` are unchanged.

Found by the agent-in-the-loop evals (`pnpm run eval:agent`) added in this
release, which could not connect to the observability proof server at all until
this was fixed.
