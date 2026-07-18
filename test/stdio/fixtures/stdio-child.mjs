const mode = process.argv[2] ?? "echo"
const decoder = new TextDecoder("utf-8", { fatal: true })
const encoder = new TextEncoder()
let buffered = new Uint8Array(0)

const append = (left, right) => {
  const out = new Uint8Array(left.byteLength + right.byteLength)
  out.set(left)
  out.set(right, left.byteLength)
  return out
}

const write = (message) => {
  const line = encoder.encode(`${JSON.stringify(message)}\n`)
  const split = Math.max(1, Math.floor(line.byteLength / 2))
  process.stdout.write(line.subarray(0, split))
  setImmediate(() => process.stdout.write(line.subarray(split)))
}

if (mode === "stubborn") {
  process.stderr.write(`pid:${process.pid}\n`)
  process.on("SIGTERM", () => process.stderr.write("sigterm\n"))
  setInterval(() => {}, 1_000)
} else {
  if (mode === "echo") process.stderr.write("fixture diagnostic\n")
  process.stdin.on("data", (chunk) => {
    buffered = append(buffered, new Uint8Array(chunk))
    let newline
    while ((newline = buffered.indexOf(0x0a)) !== -1) {
      const line = buffered.subarray(0, newline)
      buffered = buffered.subarray(newline + 1)
      const message = JSON.parse(decoder.decode(line))
      if (mode === "noise") {
        process.stdout.write("protocol noise\n")
        continue
      }
      if (mode === "exit") process.exit(23)
      if (message.method === "notifications/cancelled") {
        process.stderr.write(`cancel:${typeof message.params.requestId}:${message.params.requestId}\n`)
        continue
      }
      if (message.method === "test/hang") continue
      write({
        jsonrpc: "2.0",
        method: "notifications/message",
        params: {
          owner: message.id,
          _meta: { "io.modelcontextprotocol/subscriptionId": message.id }
        }
      })
      write({
        jsonrpc: "2.0",
        method: "notifications/message",
        params: { global: true }
      })
      const response = {
        jsonrpc: "2.0",
        id: message.id,
        result: { resultType: "complete", owner: message.id, label: "snowman ☃" }
      }
      if (typeof message.id === "number") setTimeout(() => write(response), 20)
      else write(response)
    }
  })
}
