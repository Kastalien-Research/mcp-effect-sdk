import { spawn } from "node:child_process"
import { existsSync, mkdirSync, readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import path from "node:path"
import { StringDecoder } from "node:string_decoder"
import { printConformanceIssueSummary } from "./report-conformance-failures.mjs"
import {
  conformanceEvidencePassed,
  writeConformanceEvidenceReport
} from "./readiness-evidence.mjs"

const __filename = fileURLToPath(import.meta.url)
const root = path.resolve(path.dirname(__filename), "..")
const conformancePackage = path.join(root, "test/conformance")
const conformancePackagePath = path.join(conformancePackage, "package.json")
const conformancePackageName = "@modelcontextprotocol/conformance"
const specVersion = "2026-07-28"
const outputDir = createOutputDir("authorization")
const outputTargetStates = new WeakMap()

if (!existsSync(conformancePackagePath)) {
  console.error("Missing test/conformance/package.json.")
  process.exit(1)
}

const conformancePackageJson = JSON.parse(readFileSync(conformancePackagePath, "utf8"))
const conformanceVersion = conformancePackageJson.devDependencies?.[conformancePackageName]
const authorization = buildAuthorizationArgs()

if (authorization.target.kind === "missing") {
  const evidencePath = writeConformanceEvidenceReport({
    name: "conformance-authorization",
    evidenceKind: "conformance-result",
    command: "pnpm run conformance:authorization",
    exitCode: 1,
    requirementIds: ["GR-CONF-001"],
    suite: "authorization",
    specVersion,
    conformancePackage: {
      name: conformancePackageName,
      version: conformanceVersion
    },
    target: authorization.target,
    qualification: "blocked-missing-external-target",
    artifactDir: outputDir
  })
  console.error([
    "Missing authorization conformance target.",
    "Set MCP_AUTHORIZATION_CONFORMANCE_FILE to a conformance JSON settings file,",
    "or set MCP_AUTHORIZATION_CONFORMANCE_URL plus optional",
    "MCP_AUTHORIZATION_CLIENT_ID, MCP_AUTHORIZATION_CLIENT_SECRET, and",
    "MCP_AUTHORIZATION_CALLBACK_PORT. Draft authorization hardening is tracked by #20."
  ].join(" "))
  console.error(`Writing readiness evidence to ${evidencePath}`)
  process.exit(1)
}

const runResult = await run(packageManagerPath(), [
  "--dir",
  conformancePackage,
  "exec",
  "conformance",
  "authorization",
  "--spec-version",
  "2026-07-28",
  "--output-dir",
  outputDir,
  ...authorization.args
], root, authorization.redactions)
const result = runResult.exitCode

const evidencePath = writeConformanceEvidenceReport({
  name: "conformance-authorization",
  evidenceKind: "conformance-result",
  command: "pnpm run conformance:authorization",
  exitCode: result,
  requirementIds: ["GR-CONF-001"],
  suite: "authorization",
  specVersion,
  conformancePackage: {
    name: conformancePackageName,
    version: conformanceVersion
  },
  target: authorization.target,
  artifactDir: outputDir
})
const evidence = JSON.parse(readFileSync(evidencePath, "utf8"))
if (runResult.stdoutSucceeded) {
  console.log("Completed MCP conformance authorization suite")
  console.log(`MCP conformance spec version: ${specVersion}`)
  console.log(`MCP conformance artifacts: ${outputDir}`)
  console.log(`Writing readiness evidence to ${evidencePath}`)
  printConformanceIssueSummary("MCP conformance authorization suite", outputDir)
}
process.exitCode = conformanceEvidencePassed(result, evidence) ? 0 : 1

function buildAuthorizationArgs() {
  const settingsFile = process.env.MCP_AUTHORIZATION_CONFORMANCE_FILE
  if (settingsFile) {
    return {
      args: ["--file", settingsFile],
      target: { kind: "settings-file" },
      redactions: [settingsFile]
    }
  }

  const issuerUrl = process.env.MCP_AUTHORIZATION_CONFORMANCE_URL
  if (!issuerUrl) {
    return { args: [], target: { kind: "missing" }, redactions: [] }
  }

  const args = ["--url", issuerUrl]
  appendOptional(args, "--client-id", process.env.MCP_AUTHORIZATION_CLIENT_ID)
  appendOptional(args, "--client-secret", process.env.MCP_AUTHORIZATION_CLIENT_SECRET)
  appendOptional(args, "--port", process.env.MCP_AUTHORIZATION_CALLBACK_PORT)
  return {
    args,
    target: { kind: "url" },
    redactions: [
      issuerUrl,
      process.env.MCP_AUTHORIZATION_CLIENT_ID,
      process.env.MCP_AUTHORIZATION_CLIENT_SECRET,
      process.env.MCP_AUTHORIZATION_CALLBACK_PORT
    ].filter((value) => typeof value === "string" && value.length > 0)
  }
}

function appendOptional(args, flag, value) {
  if (value) {
    args.push(flag, value)
  }
}

async function run(command, args, cwd, redactions) {
  observeOutputTarget(process.stdout)
  observeOutputTarget(process.stderr)
  const child = spawn(command, args, {
    cwd,
    stdio: ["inherit", "pipe", "pipe"]
  })
  let launchFailed = false
  child.once("error", () => {
    launchFailed = true
  })

  const stdoutForwarding = forwardRedacted(child.stdout, process.stdout, redactions)
  const stderrForwarding = forwardRedacted(child.stderr, process.stderr, redactions)
  const closeCode = new Promise((resolve) => {
    child.on("close", resolve)
  })
  const [code, stdoutForwarded, stderrForwarded] = await Promise.all([
    closeCode,
    stdoutForwarding,
    stderrForwarding
  ])
  const stdoutSucceeded = stdoutForwarded && outputTargetSucceeded(process.stdout)
  const stderrSucceeded = stderrForwarded && outputTargetSucceeded(process.stderr)

  return {
    exitCode: launchFailed || !stdoutSucceeded || !stderrSucceeded ? 1 : (code ?? 1),
    stdoutSucceeded,
    stderrSucceeded
  }
}

async function forwardRedacted(readable, target, sensitiveValues) {
  if (readable === null) return false
  const redactor = createRedactingWriter(sensitiveValues)

  try {
    for await (const chunk of readable) {
      await writeWithBackpressure(target, redactor.write(chunk))
    }
    await writeWithBackpressure(target, redactor.end())
    return true
  } catch {
    containOutputErrors(target)
    readable.resume()
    return false
  }
}

function writeWithBackpressure(target, output) {
  if (output.length === 0) return

  return new Promise((resolve, reject) => {
    let callbackCompleted = false
    let drainCompleted = false
    let settled = false
    let writeReturned = false

    const cleanup = () => {
      target.off("error", onError)
      target.off("close", onClose)
      target.off("drain", onDrain)
      process.off("beforeExit", onBeforeExit)
    }
    const fail = () => {
      if (settled) return
      settled = true
      containOutputErrors(target)
      cleanup()
      reject(new Error("Authorization output forwarding failed"))
    }
    const complete = () => {
      if (settled || !writeReturned || !callbackCompleted || !drainCompleted) return
      settled = true
      cleanup()
      resolve()
    }
    const onError = () => fail()
    const onClose = () => fail()
    const onBeforeExit = () => fail()
    const onDrain = () => {
      drainCompleted = true
      complete()
    }

    target.once("error", onError)
    target.once("close", onClose)
    target.once("drain", onDrain)
    process.once("beforeExit", onBeforeExit)
    try {
      const accepted = target.write(output, (error) => {
        if (error !== null && error !== undefined) {
          fail()
          return
        }
        callbackCompleted = true
        complete()
      })
      writeReturned = true
      if (accepted) {
        drainCompleted = true
        target.off("drain", onDrain)
      }
      complete()
    } catch {
      fail()
    }
  })
}

function containOutputErrors(target) {
  observeOutputTarget(target).succeeded = false
}

function observeOutputTarget(target) {
  const existing = outputTargetStates.get(target)
  if (existing !== undefined) return existing

  const state = { succeeded: true }
  const markFailed = () => {
    state.succeeded = false
  }
  outputTargetStates.set(target, state)
  target.on("error", markFailed)
  target.on("close", markFailed)
  process.once("exit", () => {
    target.off("error", markFailed)
    target.off("close", markFailed)
  })
  return state
}

function outputTargetSucceeded(target) {
  return observeOutputTarget(target).succeeded
}

function createRedactingWriter(sensitiveValues) {
  const patterns = Array.from(new Set(sensitiveValues))
    .filter((value) => typeof value === "string" && value.length > 0)
    .sort((left, right) => right.length - left.length)
  const decoder = new StringDecoder("utf8")
  let pending = ""

  const drain = (final) => {
    const output = []
    while (pending.length > 0) {
      const longerPartial = !final && patterns.some(
        (pattern) => pattern.length > pending.length && pattern.startsWith(pending)
      )
      if (longerPartial) return output.join("")

      const exact = patterns.find((pattern) => pending.startsWith(pattern))
      if (exact !== undefined) {
        output.push("[REDACTED]")
        pending = pending.slice(exact.length)
        continue
      }

      const partial = !final && patterns.some((pattern) => pattern.startsWith(pending))
      if (partial) return output.join("")

      const first = String.fromCodePoint(pending.codePointAt(0))
      output.push(first)
      pending = pending.slice(first.length)
    }
    return output.join("")
  }

  return {
    write(chunk) {
      pending += decoder.write(chunk)
      return drain(false)
    },
    end() {
      pending += decoder.end()
      return drain(true)
    }
  }
}

function packageManagerPath() {
  return process.platform === "win32" ? "pnpm.cmd" : "pnpm"
}

function createOutputDir(suiteName) {
  const rootDir = process.env.MCP_CONFORMANCE_OUTPUT_DIR
    ? path.resolve(root, process.env.MCP_CONFORMANCE_OUTPUT_DIR)
    : path.join(root, ".local", "conformance")
  const timestamp = new Date().toISOString().replaceAll(":", "-").replaceAll(".", "-")
  const runDir = path.join(rootDir, `${suiteName}-${timestamp}`)
  mkdirSync(runDir, { recursive: true })
  return runDir
}
