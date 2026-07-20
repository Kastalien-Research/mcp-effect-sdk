import { spawn } from "node:child_process"
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync
} from "node:fs"
import { fileURLToPath } from "node:url"
import path from "node:path"
import { StringDecoder } from "node:string_decoder"
import {
  clearConformanceEvidence,
  settleConformanceEvidenceReport
} from "./readiness-evidence.mjs"

const __filename = fileURLToPath(import.meta.url)
const root = path.resolve(path.dirname(__filename), "..")
const conformancePackage = path.join(root, "test/conformance")
const conformancePackagePath = path.join(conformancePackage, "package.json")
const conformancePackageName = "@modelcontextprotocol/conformance"
const specVersion = "2026-07-28"

containTerminalOutputErrors()
const configuredExitCode = await runConfiguredAuthorization().catch(() => 1)
process.exit(configuredExitCode)

async function runConfiguredAuthorization() {
  const outputDir = createOutputDir("authorization")
  clearConformanceEvidence({
    name: "conformance-authorization",
    artifactDir: outputDir
  })

  if (!existsSync(conformancePackagePath)) {
    console.error("Missing test/conformance/package.json.")
    return 1
  }

  const conformancePackageJson = JSON.parse(readFileSync(conformancePackagePath, "utf8"))
  const conformanceVersion = conformancePackageJson.devDependencies?.[conformancePackageName]
  const authorization = buildAuthorizationArgs()
  const evidenceOptions = {
    name: "conformance-authorization",
    evidenceKind: "conformance-result",
    command: "pnpm run conformance:authorization",
    requirementIds: ["GR-CONF-001"],
    suite: "authorization",
    specVersion,
    conformancePackage: {
      name: conformancePackageName,
      version: conformanceVersion
    },
    target: authorization.target,
    artifactDir: outputDir
  }

  if (authorization.target.kind === "missing") {
    console.error([
      "Missing authorization conformance target.",
      "Set MCP_AUTHORIZATION_CONFORMANCE_FILE to a conformance JSON settings file,",
      "or set MCP_AUTHORIZATION_CONFORMANCE_URL plus optional",
      "MCP_AUTHORIZATION_CLIENT_ID, MCP_AUTHORIZATION_CLIENT_SECRET, and",
      "MCP_AUTHORIZATION_CALLBACK_PORT. Draft authorization hardening is tracked by #20."
    ].join(" "))
    publishArtifactLogs(outputDir, { stdout: "", stderr: "" })
    return settleConformanceEvidenceReport({
      ...evidenceOptions,
      exitCode: 1,
      qualification: "blocked-missing-external-target"
    }).exitCode
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

  publishArtifactLogs(outputDir, {
    stdout: runResult.stdout,
    stderr: runResult.stderr
  })
  const normalizedChildExitCode = runResult.launchFailed || runResult.childExitCode !== 0 ? 1 : 0
  return settleConformanceEvidenceReport({
    ...evidenceOptions,
    exitCode: normalizedChildExitCode
  }).exitCode
}

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
  if (value) args.push(flag, value)
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

  const stdoutCapture = captureRedacted(child.stdout, redactions)
  const stderrCapture = captureRedacted(child.stderr, redactions)
  const closeCode = new Promise((resolve) => {
    child.on("close", resolve)
  })
  const [code, stdout, stderr] = await Promise.all([
    closeCode,
    stdoutCapture,
    stderrCapture
  ])

  return {
    childExitCode: code ?? 1,
    launchFailed,
    stdout,
    stderr
  }
}

async function captureRedacted(readable, sensitiveValues) {
  if (readable === null) throw new Error("Authorization child output stream is unavailable")
  const redactor = createRedactingWriter(sensitiveValues)
  let output = ""
  for await (const chunk of readable) {
    output += redactor.write(chunk)
  }
  output += redactor.end()
  return output
}

function publishArtifactLogs(artifactDir, output) {
  const stdoutPath = path.join(artifactDir, "stdout.log")
  const stderrPath = path.join(artifactDir, "stderr.log")
  try {
    publishArtifactLog(stdoutPath, output.stdout)
    publishArtifactLog(stderrPath, output.stderr)
  } catch (error) {
    rmSync(stdoutPath, { force: true })
    rmSync(stderrPath, { force: true })
    throw error
  }
}

function publishArtifactLog(logPath, contents) {
  const temporaryPath = path.join(
    path.dirname(logPath),
    `.${path.basename(logPath)}.${process.pid}.tmp`
  )
  try {
    writeFileSync(temporaryPath, contents, { flag: "wx" })
    renameSync(temporaryPath, logPath)
    if (readFileSync(logPath, "utf8") !== contents) {
      throw new Error("Published authorization output log did not match captured bytes")
    }
  } finally {
    rmSync(temporaryPath, { force: true })
  }
}

function containTerminalOutputErrors() {
  process.stdout.on("error", () => {})
  process.stderr.on("error", () => {})
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
