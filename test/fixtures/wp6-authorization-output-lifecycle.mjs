import { writeFileSync } from "node:fs"

export const outputLifecycleScenarios = Object.freeze([
  { id: "native-success", expectedExitCode: 0, transition: "native callback success" },
  { id: "callback-sync-success", expectedExitCode: 0, transition: "true + synchronous callback success" },
  { id: "callback-async-success", expectedExitCode: 0, transition: "true + immediate callback success" },
  { id: "backpressure-drain-success", expectedExitCode: 0, transition: "false + callback success + drain" },
  { id: "callback-async-error", expectedExitCode: 1, transition: "true + immediate callback error" },
  { id: "close-before-callback", expectedExitCode: 1, transition: "true + close + absent callback" },
  { id: "silent-accepted", expectedExitCode: 1, transition: "true + absent callback/event" },
  { id: "silent-backpressured", expectedExitCode: 1, transition: "false + absent callback/event" },
  { id: "synchronous-throw", expectedExitCode: 1, transition: "write throws" },
  { id: "post-callback-microtask-error", expectedExitCode: 1, transition: "callback success + microtask error" },
  { id: "post-callback-timer-error", expectedExitCode: 1, transition: "callback success + timer error" },
  { id: "before-exit-microtask-error", expectedExitCode: 1, transition: "beforeExit + microtask error" },
  { id: "before-exit-timer-error", expectedExitCode: 1, transition: "beforeExit + timer error + repeated beforeExit" },
  { id: "before-exit-immediate-error", expectedExitCode: 1, transition: "beforeExit + immediate error + repeated beforeExit" },
  { id: "exit-sync-error", expectedExitCode: 1, transition: "one-shot exit + synchronous error" }
])

const scenarioId = process.env.MCP_WP6_OUTPUT_LIFECYCLE_SCENARIO
if (scenarioId !== undefined) installScenario(scenarioId)

function installScenario(id) {
  const scenario = outputLifecycleScenarios.find((candidate) => candidate.id === id)
  if (scenario === undefined) throw new Error("Unknown synthetic output lifecycle scenario")

  const marker = process.env.MCP_WP6_OUTPUT_LIFECYCLE_MARKER ?? ""
  const reportPath = process.env.MCP_WP6_OUTPUT_LIFECYCLE_REPORT
  const report = {
    id,
    beforeExitCount: 0,
    interceptedWrites: 0,
    eventFired: false
  }
  const originalWrite = process.stdout.write.bind(process.stdout)
  const completionOf = (encoding, callback) => typeof encoding === "function" ? encoding : callback
  const emitFailure = () => {
    report.eventFired = true
    process.stdout.emit("error", new Error("synthetic output lifecycle failure"))
  }

  process.on("beforeExit", () => {
    report.beforeExitCount++
  })

  if (id === "before-exit-microtask-error") {
    process.once("beforeExit", () => queueMicrotask(emitFailure))
  } else if (id === "before-exit-timer-error") {
    process.once("beforeExit", () => setTimeout(emitFailure, 0))
  } else if (id === "before-exit-immediate-error") {
    process.once("beforeExit", () => setImmediate(emitFailure))
  } else if (id === "exit-sync-error") {
    process.once("exit", emitFailure)
  }

  if (!["native-success", "before-exit-microtask-error", "before-exit-timer-error", "before-exit-immediate-error", "exit-sync-error"].includes(id)) {
    process.stdout.write = function lifecycleWrite(chunk, encoding, callback) {
      if (!String(chunk).includes(marker)) return originalWrite(...arguments)
      report.interceptedWrites++
      const completion = completionOf(encoding, callback)

      switch (id) {
        case "callback-sync-success":
          if (typeof completion === "function") completion()
          return true
        case "callback-async-success":
          setImmediate(() => completion?.())
          return true
        case "backpressure-drain-success":
          setImmediate(() => completion?.())
          setImmediate(() => process.stdout.emit("drain"))
          return false
        case "callback-async-error":
          setImmediate(() => completion?.(new Error("synthetic callback failure")))
          return true
        case "close-before-callback":
          setImmediate(() => process.stdout.emit("close"))
          return true
        case "silent-accepted":
          return true
        case "silent-backpressured":
          return false
        case "synchronous-throw":
          throw new Error("synthetic synchronous output failure")
        case "post-callback-microtask-error":
          if (typeof completion === "function") completion()
          queueMicrotask(emitFailure)
          return true
        case "post-callback-timer-error":
          if (typeof completion === "function") completion()
          setTimeout(emitFailure, 0)
          return true
      }
    }
  }

  process.once("exit", () => {
    if (reportPath !== undefined) writeFileSync(reportPath, JSON.stringify(report))
  })
}
