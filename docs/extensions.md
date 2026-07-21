# Extension Policy

Extensions are disabled by default.

The package exposes the Tasks protocol overlay only through
`mcp-effect-sdk/experimental/tasks`. This schema-and-type boundary is pinned to
the `io.modelcontextprotocol/tasks` extension revision
`2c1425d9a288b9b1f489430fe1e00bb392b47e48` and is outside the stable SemVer
guarantee. It does not implement task execution, storage, polling,
subscriptions, or transport dispatch.

Users may explicitly advertise other extension capabilities through `McpServer`
server options only when they are intentionally integrating with a peer that
understands those capabilities.

Extension capability names must be namespaced as `namespace/name`. Malformed
extension names are rejected before the server advertises capabilities.

Extension behavior is not core MCP conformance evidence. Core conformance is
limited to stable protocol behavior under `src/generated/mcp/**` and the
conformance evidence in `docs/conformance/**`.

Generated protocol files must not import extension policy code. Concrete
extensions live outside `src/generated/mcp/**` and remain disabled unless the
user opts in explicitly.
