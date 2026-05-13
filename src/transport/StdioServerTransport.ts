/**
 * MCP stdio server transport.
 *
 * This is the package-local server-side stdio transport surface. It delegates
 * to the SDK server runtime instead of defining protocol behavior separately.
 */
import * as McpServer from "../McpServer.js"

export interface StdioServerTransportOptions {
  readonly name: string
  readonly version: string
  readonly extensions?: McpServer.ExtensionCapabilities | undefined
}

/**
 * Create a stdio-backed MCP server layer.
 */
export const layer = (
  options: StdioServerTransportOptions
) => McpServer.layerStdio(options)

