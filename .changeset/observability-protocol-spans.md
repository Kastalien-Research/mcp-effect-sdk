---
"mcp-effect-sdk": minor
---

Emit tracing spans at MCP protocol boundaries.

The SDK previously emitted no spans at all, so a consumer providing any Effect
tracer — Effect Dev Tools, OpenTelemetry, or their own — saw an empty timeline.
Server request dispatch and client request dispatch now open spans named
`mcp.server.dispatch` and `mcp.client.dispatch`, carrying the JSON-RPC method
and request id.

The SDK stays tracing-agnostic: it emits through Effect's `Tracer` and never
installs one, so there is no new runtime dependency and no behaviour change for
consumers who provide no tracer.

Span names and attribute keys are exported from `mcp-effect-sdk` as `SpanName`
and `SpanAttribute`. They are a public surface that dashboards and alerts get
written against, so renames will be treated as breaking.

Attributes are restricted to protocol metadata. Message bodies, headers, tool
arguments and results, and authorization material are deliberately excluded —
traces routinely cross a trust boundary that the payload does not — and a test
asserts no span attribute key or value looks secret-bearing.
