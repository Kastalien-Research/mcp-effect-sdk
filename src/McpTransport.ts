/** Minimal request-scoped transport boundary shared by MCP clients. */
import type * as Stream from "effect/Stream"
import type { ClientFrame } from "./McpDispatcher.js"
import type { JsonRpcRequest } from "./McpWire.js"

export interface McpTransport<E> {
  readonly request: (request: JsonRpcRequest) => Stream.Stream<ClientFrame, E>
}
