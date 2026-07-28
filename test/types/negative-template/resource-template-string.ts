import { Effect, Schema } from "effect"
import { McpSchema, McpServer } from "../../../src/index.js"

const numericId = McpSchema.param("numericId", Schema.NumberFromString)

McpServer.resource`fixture://items/${numericId}`({
  name: "numeric-template",
  content: (_uri, id) => {
    const invalidString: string = id
    return Effect.succeed(invalidString)
  }
})
