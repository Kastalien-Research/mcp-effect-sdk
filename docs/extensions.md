# Extension Policy

Extensions are disabled by default.

This package currently supports no concrete extension protocols. Users may
explicitly advertise extension capabilities through `McpServer` server options
only when they are intentionally integrating with a peer that understands those
capabilities.

Extension capability names must be namespaced as `namespace/name`. Malformed
extension names are rejected before the server advertises capabilities.

Extension behavior is not core MCP conformance evidence. Core conformance is
limited to stable protocol behavior under `src/generated/mcp/**` and the
conformance evidence in `docs/conformance/**`.

Generated protocol files must not import extension policy code. If concrete
extensions are added later, they should live outside `src/generated/mcp/**` and
remain disabled unless the user opts in explicitly.
