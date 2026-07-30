"use client"

import dynamic from "next/dynamic"
import { BrowserEffectRuntime } from "../src/observability/BrowserEffectRuntime"

const McpIdeApp = dynamic(
  () => import("../src/mcp-ide/McpIdeApp").then(mod => ({ default: mod.McpIdeApp })),
  {
    ssr: false,
  },
)

export default function ClientAppContent() {
  return (
    <BrowserEffectRuntime>
      <McpIdeApp />
    </BrowserEffectRuntime>
  )
}
