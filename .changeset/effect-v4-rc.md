---
"mcp-effect-sdk": major
---

Migrate the SDK to Effect 4.0.0-rc.112. Consumers must use that exact Effect RC;
the HTTP integration now uses `effect/unstable/http` and no longer requires an
`@effect/platform` peer. Generated codecs, service declarations, schema hooks,
and error results use native v4 APIs. See `docs/migrations/effect-v4.md` for
consumer changes and the retained MCP protocol scope.
