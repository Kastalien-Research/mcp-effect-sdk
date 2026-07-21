import { spawn, spawnSync } from "node:child_process"
import { existsSync, mkdirSync, writeFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

const scriptPath = fileURLToPath(import.meta.url)
const defaultRepositoryRoot = path.resolve(path.dirname(scriptPath), "..")

export function parseCompositeArguments(rawArguments, repositoryRoot = defaultRepositoryRoot) {
  let artifactDirectory
  let mode
  let strictRepo = false
  let includeConformance = false

  for (let index = 0; index < rawArguments.length; index += 1) {
    const argument = rawArguments[index]
    if (argument === "--strict-repo") {
      strictRepo = true
      continue
    }
    if (argument === "--include-conformance") {
      includeConformance = true
      continue
    }
    if (argument === "--mode" || argument === "--artifact-dir") {
      const value = rawArguments[index + 1]
      if (!value || value.startsWith("--")) throw new Error(`${argument} requires a value`)
      if (argument === "--mode") mode = value
      else artifactDirectory = value
      index += 1
      continue
    }
    throw new Error(`Unknown argument: ${argument}`)
  }

  if (mode !== "fixture" && mode !== "contract") {
    throw new Error("--mode must be fixture|contract")
  }
  if (!artifactDirectory) throw new Error("--artifact-dir <absolute> is required")
  validateExternalArtifactDirectory(artifactDirectory, repositoryRoot)
  return { artifactDirectory, includeConformance, mode, strictRepo }
}

export async function runAppsIdeVerification(options) {
  const repositoryRoot = path.resolve(options.repositoryRoot ?? defaultRepositoryRoot)
  const visualEffectRoot = path.join(repositoryRoot, "visual-effect")
  const artifactDirectory = path.resolve(options.artifactDirectory)
  validateExternalArtifactDirectory(options.artifactDirectory, repositoryRoot)
  const logsDirectory = path.join(artifactDirectory, "logs")
  mkdirSync(logsDirectory, { recursive: true })

  const runner = options.commandRunner ?? runCommand
  const results = []
  const commandGates = [
    {
      id: "ide-focused",
      lane: "fixture",
      executable: "bun",
      arguments: [
        "run",
        "verify:mcp-ide",
        "--",
        "--artifact-dir",
        path.join(artifactDirectory, "mcp-ide"),
      ],
      cwd: visualEffectRoot,
      required: true,
      inputs: { proof: "fixture and IDE read-model behavior" },
      extraArtifacts: { report: path.join("mcp-ide", "mcp-ide.json") },
    },
  ]

  const contractVerifierPath = path.resolve(
    options.contractVerifierPath ?? path.join(repositoryRoot, "scripts", "check-apps-contract.mjs"),
  )
  if (options.mode === "contract") {
    if (existsSync(contractVerifierPath)) {
      commandGates.push({
        id: "apps-sdk-contract",
        lane: "sdk-contract",
        executable: "node",
        arguments: [contractVerifierPath],
        cwd: repositoryRoot,
        required: true,
        environment: {
          MCP_READINESS_EVIDENCE_DIR: path.join(artifactDirectory, "sdk-evidence"),
        },
        inputs: { verifier: contractVerifierPath },
        extraArtifacts: { evidenceDirectory: "sdk-evidence" },
      })
    } else {
      results.push(
        createNonCommandResult({
          artifactDirectory,
          command: formatCommand("node", [contractVerifierPath]),
          cwd: repositoryRoot,
          id: "apps-sdk-contract",
          lane: "sdk-contract",
          required: true,
          status: "not-configured",
          message: `Apps SDK contract verifier is not configured: ${contractVerifierPath}`,
          inputs: { verifier: contractVerifierPath },
        }),
      )
    }
  }

  commandGates.push({
    id: "repository-hygiene",
    lane: "repository-hygiene",
    executable: "bun",
    arguments: ["run", "verify"],
    cwd: visualEffectRoot,
    required: options.strictRepo,
    environment: { CI: "1" },
    inputs: { scope: "visual-effect whole-app", strictRepo: options.strictRepo },
    extraArtifacts: {},
  })

  if (options.includeConformance) {
    commandGates.push({
      id: "official-server-conformance",
      lane: "official-conformance",
      executable: "pnpm",
      arguments: ["run", "conformance:run"],
      cwd: repositoryRoot,
      required: false,
      environment: {
        MCP_CONFORMANCE_OUTPUT_DIR: path.join(artifactDirectory, "conformance"),
        MCP_READINESS_EVIDENCE_DIR: path.join(artifactDirectory, "sdk-evidence"),
      },
      inputs: { qualification: "official server conformance" },
      extraArtifacts: { conformanceDirectory: "conformance", evidenceDirectory: "sdk-evidence" },
    })
    results.push(
      createNonCommandResult({
        artifactDirectory,
        command: "pnpm run conformance:authorization",
        cwd: repositoryRoot,
        id: "official-authorization-conformance",
        lane: "official-conformance",
        required: false,
        status: "not-run",
        message: "Authorization conformance not run: missing explicit target",
        inputs: { explicitTarget: false, qualification: "official authorization conformance" },
      }),
    )
  }

  for (const gate of commandGates) {
    const startedAt = Date.now()
    const execution = await runner(gate)
    const durationMs = Date.now() - startedAt
    results.push(writeCommandResult(artifactDirectory, gate, execution, durationMs))
  }

  const orderedResults = orderResults(results, commandGates)
  const summary = summarize(orderedResults)
  const report = {
    schemaVersion: "1",
    kind: "apps-ide-lanes-verification",
    generatedAt: new Date().toISOString(),
    commit: options.commit ?? resolveCommit(repositoryRoot),
    mode: options.mode,
    strictRepo: options.strictRepo,
    includeConformance: options.includeConformance,
    overallStatus: summary.requiredUnmet === 0 ? "passed" : "failed",
    summary,
    gates: orderedResults,
  }

  writeFileSync(
    path.join(artifactDirectory, "summary.json"),
    `${JSON.stringify(report, null, 2)}\n`,
  )
  writeFileSync(path.join(artifactDirectory, "summary.md"), renderMarkdownSummary(report))
  return report
}

function writeCommandResult(artifactDirectory, gate, execution, durationMs) {
  const stdoutLog = path.join("logs", `${gate.id}.stdout.log`)
  const stderrLog = path.join("logs", `${gate.id}.stderr.log`)
  writeFileSync(path.join(artifactDirectory, stdoutLog), execution.stdout)
  writeFileSync(path.join(artifactDirectory, stderrLog), execution.stderr)
  const status = execution.exitCode === 0 ? "passed" : "failed"
  return {
    id: gate.id,
    lane: gate.lane,
    command: formatCommand(gate.executable, gate.arguments),
    cwd: gate.cwd,
    exitCode: execution.exitCode,
    durationMs,
    required: gate.required,
    status,
    inputs: gate.inputs,
    artifacts: { stdoutLog, stderrLog, ...gate.extraArtifacts },
    ...(status === "failed"
      ? { failureExcerpt: failureExcerpt(execution.stderr, execution.stdout) }
      : {}),
  }
}

function createNonCommandResult(options) {
  const stdoutLog = path.join("logs", `${options.id}.stdout.log`)
  const stderrLog = path.join("logs", `${options.id}.stderr.log`)
  writeFileSync(path.join(options.artifactDirectory, stdoutLog), "")
  writeFileSync(path.join(options.artifactDirectory, stderrLog), `${options.message}\n`)
  return {
    id: options.id,
    lane: options.lane,
    command: options.command ?? "not configured",
    cwd: options.cwd ?? defaultRepositoryRoot,
    exitCode: null,
    durationMs: 0,
    required: options.required,
    status: options.status,
    inputs: options.inputs,
    artifacts: { stdoutLog, stderrLog },
    failureExcerpt: options.message,
  }
}

function orderResults(results, commandGates) {
  const order = ["ide-focused", "apps-sdk-contract", "repository-hygiene"]
  if (commandGates.some(gate => gate.id === "official-server-conformance")) {
    order.push("official-server-conformance")
    order.push("official-authorization-conformance")
  }
  return [...results].sort((left, right) => order.indexOf(left.id) - order.indexOf(right.id))
}

function summarize(results) {
  const count = status => results.filter(result => result.status === status).length
  return {
    failed: count("failed"),
    notConfigured: count("not-configured"),
    notRun: count("not-run"),
    passed: count("passed"),
    requiredUnmet: results.filter(result => result.required && result.status !== "passed").length,
    total: results.length,
  }
}

function renderMarkdownSummary(report) {
  const lines = [
    `# Apps and IDE lanes: ${report.overallStatus}`,
    "",
    `Mode: \`${report.mode}\`. Commit: \`${report.commit}\`. Required unmet: ${report.summary.requiredUnmet}.`,
    "",
    "| Gate | Lane | Required | Status | Exit |",
    "| --- | --- | --- | --- | --- |",
  ]
  for (const gate of report.gates) {
    lines.push(
      `| ${gate.id} | ${gate.lane} | ${String(gate.required)} | ${gate.status} | ${gate.exitCode ?? "-"} |`,
    )
  }
  lines.push("")
  return `${lines.join("\n")}\n`
}

function validateExternalArtifactDirectory(artifactDirectory, repositoryRoot) {
  if (!path.isAbsolute(artifactDirectory)) {
    throw new Error("--artifact-dir must be an absolute path")
  }
  const relative = path.relative(path.resolve(repositoryRoot), path.resolve(artifactDirectory))
  const isInsideRepository =
    relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative))
  if (isInsideRepository) throw new Error("--artifact-dir must be outside the repository")
}

function runCommand(gate) {
  return new Promise(resolve => {
    const child = spawn(gate.executable, gate.arguments, {
      cwd: gate.cwd,
      env: { ...process.env, ...gate.environment },
      stdio: ["ignore", "pipe", "pipe"],
    })
    const stdout = []
    const stderr = []
    let settled = false
    child.stdout.on("data", chunk => stdout.push(Buffer.from(chunk)))
    child.stderr.on("data", chunk => stderr.push(Buffer.from(chunk)))
    child.once("error", error => {
      if (settled) return
      settled = true
      resolve({
        exitCode: 1,
        stdout: Buffer.concat(stdout).toString(),
        stderr: `${error.message}\n`,
      })
    })
    child.once("close", code => {
      if (settled) return
      settled = true
      resolve({
        exitCode: code ?? 1,
        stdout: Buffer.concat(stdout).toString(),
        stderr: Buffer.concat(stderr).toString(),
      })
    })
  })
}

function resolveCommit(repositoryRoot) {
  const result = spawnSync("git", ["rev-parse", "HEAD"], {
    cwd: repositoryRoot,
    encoding: "utf8",
  })
  return result.status === 0 ? result.stdout.trim() : "unknown"
}

function formatCommand(executable, commandArguments) {
  return [executable, ...commandArguments]
    .map(argument => (/^[a-zA-Z0-9_./:@=-]+$/.test(argument) ? argument : JSON.stringify(argument)))
    .join(" ")
}

function failureExcerpt(stderr, stdout) {
  const source = stderr.trim() || stdout.trim() || "Command exited without output"
  return source.slice(-2_000)
}

if (process.argv[1] && path.resolve(process.argv[1]) === scriptPath) {
  try {
    const options = parseCompositeArguments(process.argv.slice(2))
    const report = await runAppsIdeVerification(options)
    console.log(`Apps/IDE lane verification ${report.overallStatus}: ${options.artifactDirectory}`)
    if (report.overallStatus === "failed") process.exitCode = 1
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 1
  }
}
