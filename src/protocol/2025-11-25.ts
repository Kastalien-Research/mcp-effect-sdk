/** Explicit protocol surface for the stateful MCP `2025-11-25` profile. */
export * as McpSchema from "../generated/mcp/2025-11-25/McpSchema.generated.js"
export * as McpProtocol from "../generated/mcp/2025-11-25/McpProtocol.generated.js"
export * as McpWire from "../McpWire.js"
export * as McpErrors from "../McpErrors.js"

export const LEGACY_PROTOCOL_VERSION = "2025-11-25" as const
export const MCP_SESSION_ID_HEADER = "Mcp-Session-Id" as const
export const MCP_PROTOCOL_VERSION_HEADER = "MCP-Protocol-Version" as const
