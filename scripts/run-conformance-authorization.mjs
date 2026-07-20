import { spawn } from "node:child_process"
import { once } from "node:events"
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

console.log("Running MCP conformance authorization suite")
console.log(`MCP conformance spec version: ${specVersion}`)
console.log(`Writing MCP conformance artifacts to ${outputDir}`)

const result = await run(packageManagerPath(), [
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
console.log(`Writing readiness evidence to ${evidencePath}`)
printConformanceIssueSummary("MCP conformance authorization suite", outputDir)
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
  const child = spawn(command, args, {
    cwd,
    stdio: ["inherit", "pipe", "pipe"]
  })
  let launchFailed = false
  child.once("error", () => {
    launchFailed = true
  })

  const stdoutForwarded = forwardRedacted(child.stdout, process.stdout, redactions)
  const stderrForwarded = forwardRedacted(child.stderr, process.stderr, redactions)
  const closeCode = new Promise((resolve) => {
    child.on("close", resolve)
  })
  const [code, stdoutSucceeded, stderrSucceeded] = await Promise.all([
    closeCode,
    stdoutForwarded,
    stderrForwarded
  ])

  return launchFailed || !stdoutSucceeded || !stderrSucceeded ? 1 : (code ?? 1)
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
    readable.resume()
    return false
  }
}

async function writeWithBackpressure(target, output) {
  if (output.length === 0) return

  let accepted = false
  const completed = new Promise((resolve, reject) => {
    const onError = (error) => reject(error)
    target.once("error", onError)
    try {
      accepted = target.write(output, (error) => {
        if (error !== null && error !== undefined) {
          reject(error)
          setImmediate(() => target.off("error", onError))
          return
        }
        target.off("error", onError)
        resolve()
      })
    } catch (error) {
      target.off("error", onError)
      reject(error)
    }
  })

  if (accepted) {
    await completed
  } else {
    await Promise.all([completed, once(target, "drain")])
  }
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
