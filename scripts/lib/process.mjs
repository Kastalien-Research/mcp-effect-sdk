// Subprocess, port, and readiness helpers shared by the suite runners.
//
// Each of these existed in two to four near-identical copies across
// run-conformance-suite, run-conformance-client, run-conformance-client-auth,
// run-conformance-authorization, and run-2026-07-28-e2e. The copies had already
// drifted: only the suite runner sanitized the directory name it built, so the
// same argument produced different paths depending on which runner you called.
// Extracting them makes that class of divergence impossible.
import { spawn } from "node:child_process"
import { mkdirSync } from "node:fs"
import { createConnection, createServer } from "node:net"
import path from "node:path"
import { fileURLToPath } from "node:url"
import * as Cause from "effect/Cause"
import * as Effect from "effect/Effect"

import { makeDevToolsRuntimeLayer } from "./observability.mjs"

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..")

const SAFE_SPAN_LABEL = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/

const spanLabel = (value, fallback) => (typeof value === "string" && SAFE_SPAN_LABEL.test(value) ? value : fallback)

/** Run a command to completion, inheriting stdio. Resolves with its exit code. */
export const runCommand = (command, commandArguments, cwd, options = {}) =>
  Effect.async((resume, signal) => {
    const child = spawn(command, commandArguments, { cwd, stdio: "inherit" })
    const hasExited = () => child.exitCode !== null || child.signalCode !== null
    let fallback

    let settled = false
    const settle = (value) => {
      if (settled) return
      settled = true
      resume(value)
    }

    const clearTermination = () => {
      signal.removeEventListener("abort", terminate)
      if (fallback !== undefined) clearTimeout(fallback)
    }

    const terminate = () => {
      if (hasExited()) return
      child.kill("SIGTERM")
      fallback = setTimeout(() => {
        if (!hasExited()) {
          child.kill("SIGKILL")
        }
      }, options.forceKillAfterMs ?? 5000)
    }

    child.once("error", (error) => {
      clearTermination()
      settle(Effect.fail(error))
    })
    child.once("exit", (code, signal) => {
      clearTermination()
      if (signal) {
        settle(Effect.fail(new Error(`command terminated with signal ${signal}`)))
        return
      }
      settle(Effect.succeed(code ?? 1))
    })

    signal.addEventListener("abort", terminate, { once: true })
    if (signal.aborted) terminate()
  }).pipe(
    Effect.withSpan("mcp.script.command", {
      captureStackTrace: false,
      attributes: {
        "mcp.script.command": spanLabel(options.label, "(unlabeled)")
      }
    })
  )

/** Shared scoped entrypoint wrapper for scripts. */
export const runScript = (name, main) =>
  Effect.scoped(
    Effect.gen(function* () {
      const program = Effect.suspend(() => (typeof main === "function" ? main() : main))
      const exit = yield* Effect.exit(program)
      if (exit._tag === "Failure") {
        if (Cause.isInterruptedOnly(exit.cause)) {
          console.error(`${spanLabel(name, "script")} was interrupted.`)
        } else {
          console.error(`${spanLabel(name, "script")} failed.`)
        }
        yield* Effect.fail(new Error(Cause.pretty(exit.cause)))
      }
    }).pipe(
      Effect.withSpan("mcp.script.run", {
        captureStackTrace: false,
        attributes: {
          "mcp.script.name": spanLabel(name, "(redacted)")
        }
      }),
      Effect.provide(makeDevToolsRuntimeLayer())
    )
  )

export function packageManagerPath() {
  return process.platform === "win32" ? "pnpm.cmd" : "pnpm"
}

/**
 * Timestamped artifact directory for one suite run. The suite name is
 * sanitized because it reaches the filesystem: a scenario id containing a
 * slash would otherwise silently create a nested directory that the artifact
 * collectors do not walk.
 */
export function createOutputDir(suiteName, { root = repositoryRoot, envVar = "MCP_CONFORMANCE_OUTPUT_DIR" } = {}) {
  const configured = process.env[envVar]
  const rootDir = configured ? path.resolve(root, configured) : path.join(root, ".local", "conformance")
  const timestamp = new Date().toISOString().replaceAll(":", "-").replaceAll(".", "-")
  const safeSuiteName = String(suiteName).replace(/[^a-z0-9_-]/gi, "-")
  const runDir = path.join(rootDir, `${safeSuiteName}-${timestamp}`)
  mkdirSync(runDir, { recursive: true })
  return runDir
}

/** Ask the OS for a free port by binding to 0 and reading back the assignment. */
export function findOpenPort(listenHost) {
  return new Promise((resolve, reject) => {
    const probe = createServer()
    probe.once("error", reject)
    probe.listen(0, listenHost, () => {
      const address = probe.address()
      if (!address || typeof address !== "object") {
        probe.close(() => reject(new Error("Unable to allocate a localhost port")))
        return
      }
      const allocatedPort = String(address.port)
      probe.close(() => resolve(allocatedPort))
    })
  })
}

/** Resolves true if a TCP connection to host:port succeeds within 500ms. */
export function canConnect(connectHost, connectPort) {
  return new Promise((resolve) => {
    const socket = createConnection({ host: connectHost, port: connectPort })
    const settle = (value) => {
      socket.destroy()
      resolve(value)
    }
    socket.once("connect", () => settle(true))
    socket.once("error", () => settle(false))
    socket.setTimeout(500, () => settle(false))
  })
}

/**
 * Poll until a spawned server accepts connections.
 *
 * Rejects as soon as the child exits rather than waiting out the full timeout,
 * so a server that dies on startup reports its own output instead of a generic
 * timeout. `describe` names the server in both messages.
 */
export function waitForReady({ child, host, port, url, timeoutMs, describe, readOutput = () => "" }) {
  return new Promise((resolve, reject) => {
    const started = Date.now()
    const timer = setInterval(async () => {
      if (child.exitCode !== null) {
        clearInterval(timer)
        reject(new Error(`${describe} exited before readiness. Output:\n${readOutput()}`))
        return
      }
      if (await canConnect(host, Number(port))) {
        clearInterval(timer)
        resolve()
        return
      }
      if (Date.now() - started > timeoutMs) {
        clearInterval(timer)
        reject(new Error(`Timed out waiting for ${describe} at ${url}`))
      }
    }, 250)
  })
}
