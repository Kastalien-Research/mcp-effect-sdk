import { writeFileSync } from "node:fs"

const stdout = "stdout"
const stderr = "stderr"

export const outputLifecycleScenarios = Object.freeze([
  { id: "native-success", transition: "artifact capture without a terminal trap", childOutput: stdout },
  { id: "callback-sync-success", transition: "true + synchronous callback success", childOutput: stdout },
  { id: "callback-async-success", transition: "true + immediate callback success", childOutput: stdout },
  { id: "backpressure-drain-success", transition: "false + callback success + drain", childOutput: stdout },
  { id: "drain-before-callback", transition: "drain event before callback", childOutput: stdout },
  { id: "error-before-callback", transition: "error event before callback", childOutput: stdout },
  { id: "error-without-callback", transition: "error event with no callback", childOutput: stdout },
  { id: "callback-async-error", transition: "true + immediate callback error", childOutput: stdout },
  { id: "close-before-callback", transition: "true + close + absent callback", childOutput: stdout },
  { id: "silent-accepted", transition: "true + absent callback/event", childOutput: stdout },
  { id: "silent-backpressured", transition: "false + absent callback/event", childOutput: stdout },
  { id: "synchronous-throw", transition: "write throws", childOutput: stdout },
  { id: "post-callback-microtask-error", transition: "callback success + microtask error", childOutput: stdout },
  { id: "post-callback-timer-error", transition: "callback success + timer error", childOutput: stdout },
  { id: "before-exit-microtask-error", transition: "beforeExit + microtask error", childOutput: stdout },
  { id: "before-exit-timer-error", transition: "beforeExit + timer error + repeated beforeExit", childOutput: stdout },
  { id: "before-exit-immediate-error", transition: "beforeExit + immediate error + repeated beforeExit", childOutput: stdout },
  { id: "exit-sync-error", transition: "preloaded exit listener + synchronous error", childOutput: stdout },
  {
    id: "exit-listener-from-before-exit",
    transition: "exit listener registered during earlier beforeExit",
    childOutput: stdout
  },
  { id: "stderr-only-error", transition: "stderr-only destination error", childOutput: stderr },
  { id: "dual-sink-error-drain", transition: "stdout drain and stderr error interaction", childOutput: "both" }
].map((scenario) => Object.freeze({ ...scenario, expectedExitCode: 0 })))

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
    interceptedWrites: { stdout: 0, stderr: 0 },
    callbacks: 0,
    eventFired: false
  }
  const persistReport = () => {
    if (reportPath !== undefined) writeFileSync(reportPath, JSON.stringify(report))
  }
  const completionOf = (encoding, callback) => typeof encoding === "function" ? encoding : callback
  const complete = (completion, error) => {
    report.callbacks++
    completion?.(error)
  }
  const emitFailure = (target) => {
    report.eventFired = true
    target.emit("error", new Error("synthetic output lifecycle failure"))
    persistReport()
  }

  process.on("beforeExit", () => {
    report.beforeExitCount++
  })

  if (id === "before-exit-microtask-error") {
    process.once("beforeExit", () => queueMicrotask(() => emitFailure(process.stdout)))
  } else if (id === "before-exit-timer-error") {
    process.once("beforeExit", () => setTimeout(() => emitFailure(process.stdout), 0))
  } else if (id === "before-exit-immediate-error") {
    process.once("beforeExit", () => setImmediate(() => emitFailure(process.stdout)))
  } else if (id === "exit-sync-error") {
    process.once("exit", () => emitFailure(process.stdout))
  } else if (id === "exit-listener-from-before-exit") {
    process.once("beforeExit", () => {
      process.once("exit", () => emitFailure(process.stdout))
    })
  }

  installWriteTrap(process.stdout, "stdout", id, marker, completionOf, complete, emitFailure)
  installWriteTrap(process.stderr, "stderr", id, marker, completionOf, complete, emitFailure)

  process.once("exit", persistReport)

  function installWriteTrap(target, sink, scenarioName, outputMarker, getCompletion, finish, fail) {
    const originalWrite = target.write.bind(target)
    target.write = function lifecycleWrite(chunk, encoding, callback) {
      if (!String(chunk).includes(outputMarker)) return originalWrite(...arguments)

      const appliesToSink = scenarioName === "stderr-only-error"
        ? sink === "stderr"
        : scenarioName === "dual-sink-error-drain"
          ? true
          : sink === "stdout"
      if (!appliesToSink || scenarioName === "native-success") return originalWrite(...arguments)

      report.interceptedWrites[sink]++
      const completion = getCompletion(encoding, callback)

      switch (scenarioName) {
        case "callback-sync-success":
          finish(completion)
          return true
        case "callback-async-success":
          setImmediate(() => finish(completion))
          return true
        case "backpressure-drain-success":
          setImmediate(() => finish(completion))
          setImmediate(() => target.emit("drain"))
          return false
        case "drain-before-callback":
          target.emit("drain")
          setImmediate(() => finish(completion))
          return false
        case "error-before-callback":
          fail(target)
          setImmediate(() => finish(completion))
          return true
        case "error-without-callback":
        case "stderr-only-error":
          setImmediate(() => fail(target))
          return true
        case "dual-sink-error-drain":
          if (sink === "stdout") {
            target.emit("drain")
            setImmediate(() => finish(completion))
            return false
          }
          setImmediate(() => fail(target))
          return true
        case "callback-async-error":
          setImmediate(() => finish(completion, new Error("synthetic callback failure")))
          return true
        case "close-before-callback":
          setImmediate(() => target.emit("close"))
          return true
        case "silent-accepted":
          return true
        case "silent-backpressured":
          return false
        case "synchronous-throw":
          throw new Error("synthetic synchronous output failure")
        case "post-callback-microtask-error":
          finish(completion)
          queueMicrotask(() => fail(target))
          return true
        case "post-callback-timer-error":
          finish(completion)
          setTimeout(() => fail(target), 0)
          return true
        default:
          return originalWrite(...arguments)
      }
    }
  }
}
