import type { MercuryConfig } from "./env.js"

export function mercuryGet(
  cfg: MercuryConfig,
  path: string
): Promise<Response> {
  return fetch(`${cfg.baseUrl}${path}`, {
    headers: { Authorization: `Bearer ${cfg.apiKey}` }
  })
}

export function mercuryFetch(
  cfg: MercuryConfig,
  path: string,
  body: unknown
): Promise<Response> {
  return fetch(`${cfg.baseUrl}${path}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${cfg.apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(body)
  })
}

export interface StreamCapture {
  ttfbMs: number
  ttftMs: number | null
  totalMs: number
  rawFrames: string[]
  text: string
  toolCallFrames: unknown[]
  finishReason: string | null
  sawDoneSentinel: boolean
  usage: unknown
}

export async function streamChat(
  cfg: MercuryConfig,
  body: Record<string, unknown>
): Promise<StreamCapture> {
  const t0 = performance.now()
  const res = await mercuryFetch(cfg, "/chat/completions", {
    ...body,
    stream: true
  })
  const ttfbMs = performance.now() - t0
  if (!res.ok || !res.body)
    throw new Error(`HTTP ${res.status}: ${await res.text()}`)
  const cap: StreamCapture = {
    ttfbMs,
    ttftMs: null,
    totalMs: 0,
    rawFrames: [],
    text: "",
    toolCallFrames: [],
    finishReason: null,
    sawDoneSentinel: false,
    usage: null
  }
  const reader = res.body.pipeThrough(new TextDecoderStream()).getReader()
  let buf = ""
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    buf += value
    let nl: number
    while ((nl = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, nl).trim()
      buf = buf.slice(nl + 1)
      if (!line.startsWith("data:")) continue
      const payload = line.slice(5).trim()
      cap.rawFrames.push(payload)
      if (payload === "[DONE]") {
        cap.sawDoneSentinel = true
        continue
      }
      try {
        const json = JSON.parse(payload)
        const delta = json.choices?.[0]?.delta
        if (json.usage) cap.usage = json.usage
        if (json.choices?.[0]?.finish_reason)
          cap.finishReason = json.choices[0].finish_reason
        if (delta?.tool_calls) cap.toolCallFrames.push(delta.tool_calls)
        if (typeof delta?.content === "string" && delta.content.length > 0)
          cap.text += delta.content
        if (
          cap.ttftMs === null &&
          (delta?.tool_calls || (delta?.content ?? "") !== "")
        ) {
          cap.ttftMs = performance.now() - t0
        }
      } catch {
        /* keep raw frame; parse failures are data, not errors */
      }
    }
  }
  cap.totalMs = performance.now() - t0
  return cap
}
