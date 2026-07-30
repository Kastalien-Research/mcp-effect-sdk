import { spawn } from "node:child_process"
import * as Effect from "effect/Effect"
import * as NodeRuntime from "@effect/platform-node/NodeRuntime"
import { fileURLToPath } from "node:url"
import path from "node:path"
import { runScript } from "./lib/process.mjs"

const __filename = fileURLToPath(import.meta.url)
const root = path.resolve(path.dirname(__filename), "..")
const host = process.env.HOST ?? "127.0.0.1"
const port = process.env.PORT ?? "3000"
const serverPath = path.join(root, "dist/examples/everything-server.js")

const runConformanceServer = Effect.gen(function* () {
  const exitCode = yield* runServer()
  if (exitCode !== 0) {
    yield* Effect.fail(new Error(`conformance server exited with code ${exitCode}`))
  }
})

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  NodeRuntime.runMain(runScript("run-conformance-server", runConformanceServer))
}

function runServer() {
  return new Promise((resolve) => {
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
      resolve(code ?? 0)
    })
  })
}
