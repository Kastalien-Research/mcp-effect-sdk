import { spawn } from "node:child_process"
import { fileURLToPath } from "node:url"
import path from "node:path"

const __filename = fileURLToPath(import.meta.url)
const root = path.resolve(path.dirname(__filename), "..")
const host = process.env.HOST ?? "127.0.0.1"
const port = process.env.PORT ?? "3000"
const serverPath = path.join(root, "dist/examples/everything-server.js")

const child = spawn(process.execPath, [serverPath], {
  cwd: root,
  env: { ...process.env, HOST: host, PORT: port },
  stdio: "inherit"
})

child.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal)
    return
  }
  process.exit(code ?? 0)
})
