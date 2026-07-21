import { spawn, spawnSync } from "node:child_process"
import { createHash } from "node:crypto"
import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

const scriptPath = fileURLToPath(import.meta.url)
const defaultVisualEffectRoot = path.resolve(path.dirname(scriptPath), "..")
const defaultRepositoryRoot = path.resolve(defaultVisualEffectRoot, "..")

export interface McpIdeGateDefinition {
  readonly id: string
  readonly executable: string
  readonly arguments: ReadonlyArray<string>
  readonly cwd: string
  readonly environment?: Readonly<Record<string, string>>
}

export interface CommandExecution {
  readonly exitCode: number
  readonly stdout: string
  readonly stderr: string
}

export interface McpIdeGateResult {
  readonly id: string
  readonly command: string
  readonly cwd: string
  readonly exitCode: number
  readonly durationMs: number
  readonly required: true
  readonly status: "passed" | "failed"
  readonly stdoutLog: string
  readonly stderrLog: string
  readonly failureExcerpt?: string
}

export interface McpIdeVerificationReport {
  readonly schemaVersion: "1"
  readonly kind: "mcp-ide-verification"
  readonly generatedAt: string
  readonly commit: string
  readonly fixtureHashes: Readonly<Record<string, string>>
  readonly overallStatus: "passed" | "failed"
  readonly summary: {
    readonly total: number
    readonly passed: number
    readonly failed: number
    readonly requiredFailed: number
  }
  readonly gates: ReadonlyArray<McpIdeGateResult>
}

export type McpIdeCommandRunner = (gate: McpIdeGateDefinition) => Promise<CommandExecution>

export interface RunMcpIdeVerificationOptions {
  readonly artifactDirectory: string
  readonly visualEffectRoot?: string
  readonly repositoryRoot?: string
  readonly commit?: string
  readonly commandRunner?: McpIdeCommandRunner
}

export function mcpIdeGateDefinitions(
  visualEffectRoot = defaultVisualEffectRoot,
): ReadonlyArray<McpIdeGateDefinition> {
  return [
    {
      id: "scoped-biome",
      executable: "bunx",
      arguments: [
        "biome",
        "check",
        "biome.json",
        "app/ClientAppContent.tsx",
        "app/layout.tsx",
        "app/globals.css",
        "src/mcp-ide",
        "vitest.config.ts",
        "scripts/verify-mcp-ide.mts",
        "scripts/verify-mcp-ide.test.ts",
      ],
      cwd: visualEffectRoot,
    },
    {
      id: "typecheck",
      executable: "bun",
      arguments: ["run", "typecheck"],
      cwd: visualEffectRoot,
    },
    {
      id: "mcp-ide-tests",
      executable: "bun",
      arguments: ["run", "test", "--run", "src/mcp-ide"],
      cwd: visualEffectRoot,
      environment: { CI: "1" },
    },
    {
      id: "build",
      executable: "bun",
      arguments: ["run", "build"],
      cwd: visualEffectRoot,
    },
  ]
}

export function parseMcpIdeArguments(
  rawArguments: ReadonlyArray<string>,
  repositoryRoot = defaultRepositoryRoot,
): { readonly artifactDirectory: string } {
  const argumentsWithoutSeparator = rawArguments.filter(argument => argument !== "--")
  let artifactDirectory: string | undefined

  for (let index = 0; index < argumentsWithoutSeparator.length; index += 1) {
    const argument = argumentsWithoutSeparator[index]
    if (argument !== "--artifact-dir") {
      throw new Error(`Unknown argument: ${argument}`)
    }
    const value = argumentsWithoutSeparator[index + 1]
    if (!value || value.startsWith("--")) {
      throw new Error("--artifact-dir requires a value")
    }
    if (artifactDirectory !== undefined) {
      throw new Error("--artifact-dir may be provided only once")
    }
    artifactDirectory = value
    index += 1
  }

  if (!artifactDirectory) {
    throw new Error("--artifact-dir <absolute> is required")
  }
  validateExternalArtifactDirectory(artifactDirectory, repositoryRoot)
  return { artifactDirectory }
}

export async function runMcpIdeVerification(
  options: RunMcpIdeVerificationOptions,
): Promise<McpIdeVerificationReport> {
  const visualEffectRoot = path.resolve(options.visualEffectRoot ?? defaultVisualEffectRoot)
  const repositoryRoot = path.resolve(options.repositoryRoot ?? path.dirname(visualEffectRoot))
  const artifactDirectory = path.resolve(options.artifactDirectory)
  validateExternalArtifactDirectory(options.artifactDirectory, repositoryRoot)

  const logDirectory = path.join(artifactDirectory, "logs")
  mkdirSync(logDirectory, { recursive: true })

  const runner = options.commandRunner ?? runCommand
  const results: Array<McpIdeGateResult> = []

  for (const gate of mcpIdeGateDefinitions(visualEffectRoot)) {
    const startedAt = Date.now()
    const execution = await runner(gate)
    const durationMs = Date.now() - startedAt
    const stdoutLog = path.join("logs", `${gate.id}.stdout.log`)
    const stderrLog = path.join("logs", `${gate.id}.stderr.log`)
    writeFileSync(path.join(artifactDirectory, stdoutLog), execution.stdout)
    writeFileSync(path.join(artifactDirectory, stderrLog), execution.stderr)

    const status = execution.exitCode === 0 ? "passed" : "failed"
    results.push({
      id: gate.id,
      command: formatCommand(gate.executable, gate.arguments),
      cwd: gate.cwd,
      exitCode: execution.exitCode,
      durationMs,
      required: true,
      status,
      stdoutLog,
      stderrLog,
      ...(status === "failed"
        ? { failureExcerpt: failureExcerpt(execution.stderr, execution.stdout) }
        : {}),
    })
  }

  const failed = results.filter(result => result.status === "failed").length
  const report: McpIdeVerificationReport = {
    schemaVersion: "1",
    kind: "mcp-ide-verification",
    generatedAt: new Date().toISOString(),
    commit: options.commit ?? resolveCommit(repositoryRoot),
    fixtureHashes: resolveFixtureHashes(repositoryRoot),
    overallStatus: failed === 0 ? "passed" : "failed",
    summary: {
      total: results.length,
      passed: results.length - failed,
      failed,
      requiredFailed: failed,
    },
    gates: results,
  }

  writeFileSync(
    path.join(artifactDirectory, "mcp-ide.json"),
    `${JSON.stringify(report, null, 2)}\n`,
  )
  return report
}

const canonicalFixturePaths = [
  "fixtures/mcp-apps/v1/preview-host-lifecycle.json",
  "fixtures/mcp-apps/v1/stable-view-lifecycle.json",
] as const

export function resolveFixtureHashes(repositoryRoot: string): Readonly<Record<string, string>> {
  return Object.fromEntries(
    [...canonicalFixturePaths].sort().map(relativePath => [
      relativePath,
      createHash("sha256")
        .update(readFileSync(path.join(repositoryRoot, relativePath)))
        .digest("hex"),
    ]),
  )
}

function validateExternalArtifactDirectory(
  artifactDirectory: string,
  repositoryRoot: string,
): void {
  if (!path.isAbsolute(artifactDirectory)) {
    throw new Error("--artifact-dir must be an absolute path")
  }
  const relative = path.relative(path.resolve(repositoryRoot), path.resolve(artifactDirectory))
  const isInsideRepository =
    relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative))
  if (isInsideRepository) {
    throw new Error("--artifact-dir must be outside the repository")
  }
}

function runCommand(gate: McpIdeGateDefinition): Promise<CommandExecution> {
  return new Promise(resolve => {
    const child = spawn(gate.executable, gate.arguments, {
      cwd: gate.cwd,
      env: { ...process.env, ...gate.environment },
      stdio: ["ignore", "pipe", "pipe"],
    })
    const stdout: Array<Buffer> = []
    const stderr: Array<Buffer> = []
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

function resolveCommit(repositoryRoot: string): string {
  const result = spawnSync("git", ["rev-parse", "HEAD"], {
    cwd: repositoryRoot,
    encoding: "utf8",
  })
  return result.status === 0 ? result.stdout.trim() : "unknown"
}

function formatCommand(executable: string, commandArguments: ReadonlyArray<string>): string {
  return [executable, ...commandArguments]
    .map(argument => (/^[a-zA-Z0-9_./:@=-]+$/.test(argument) ? argument : JSON.stringify(argument)))
    .join(" ")
}

function failureExcerpt(stderr: string, stdout: string): string {
  const source = stderr.trim() || stdout.trim() || "Command exited without output"
  return source.slice(-2_000)
}

function isMainModule(): boolean {
  const entry = process.argv[1]
  return entry !== undefined && path.resolve(entry) === scriptPath
}

if (isMainModule()) {
  try {
    const { artifactDirectory } = parseMcpIdeArguments(process.argv.slice(2))
    const report = await runMcpIdeVerification({ artifactDirectory })
    console.log(`MCP IDE verification ${report.overallStatus}: ${artifactDirectory}`)
    if (report.overallStatus === "failed") process.exitCode = 1
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 1
  }
}
