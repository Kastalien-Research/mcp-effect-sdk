import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { pathToFileURL } from "node:url"
import { afterEach, describe, expect, test } from "vitest"

const verifierPath = path.resolve(process.cwd(), "scripts", "verify-mcp-ide.mts")
const temporaryDirectories: Array<string> = []

async function loadVerifier() {
  return import(/* @vite-ignore */ pathToFileURL(verifierPath).href)
}

function makeArtifactDirectory(): string {
  const directory = mkdtempSync(path.join(tmpdir(), "mcp-ide-verifier-test-"))
  temporaryDirectories.push(directory)
  return directory
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { force: true, recursive: true })
  }
})

describe("MCP IDE verifier", () => {
  test("requires an absolute artifact directory outside the repository", async () => {
    expect(existsSync(verifierPath)).toBe(true)
    const { parseMcpIdeArguments } = await loadVerifier()

    expect(() => parseMcpIdeArguments([])).toThrow("--artifact-dir")
    expect(() => parseMcpIdeArguments(["--artifact-dir", "relative/artifacts"])).toThrow("absolute")
    expect(() =>
      parseMcpIdeArguments(["--artifact-dir", path.join(process.cwd(), "artifacts")]),
    ).toThrow("outside")
  })

  test("retains every independent gate result and log after one gate fails", async () => {
    expect(existsSync(verifierPath)).toBe(true)
    const { runMcpIdeVerification } = await loadVerifier()
    const artifactDirectory = makeArtifactDirectory()
    const observedGateIds: Array<string> = []

    const report = await runMcpIdeVerification({
      artifactDirectory,
      commit: "0123456789abcdef",
      commandRunner: async gate => {
        observedGateIds.push(gate.id)
        return gate.id === "typecheck"
          ? { exitCode: 2, stderr: "intentional typecheck failure\n", stdout: "" }
          : { exitCode: 0, stderr: "", stdout: `${gate.id} passed\n` }
      },
    })

    expect(observedGateIds).toEqual(["scoped-biome", "typecheck", "mcp-ide-tests", "build"])
    expect(report).toMatchObject({
      schemaVersion: "1",
      kind: "mcp-ide-verification",
      commit: "0123456789abcdef",
      overallStatus: "failed",
      summary: {
        failed: 1,
        passed: 3,
        requiredFailed: 1,
        total: 4,
      },
    })
    expect(report.gates).toHaveLength(4)

    for (const gate of report.gates) {
      expect(gate.command.length).toBeGreaterThan(0)
      expect(path.isAbsolute(gate.cwd)).toBe(true)
      expect(gate.durationMs).toBeGreaterThanOrEqual(0)
      expect(gate.required).toBe(true)
      expect(["passed", "failed"]).toContain(gate.status)
      expect(readFileSync(path.join(artifactDirectory, gate.stdoutLog), "utf8")).toBeDefined()
      expect(readFileSync(path.join(artifactDirectory, gate.stderrLog), "utf8")).toBeDefined()
    }

    const persisted = JSON.parse(readFileSync(path.join(artifactDirectory, "mcp-ide.json"), "utf8"))
    expect(persisted.gates.map((gate: { id: string }) => gate.id)).toEqual(observedGateIds)
    expect(persisted.gates.find((gate: { id: string }) => gate.id === "typecheck")).toMatchObject({
      exitCode: 2,
      status: "failed",
    })
  })

  test("uses read-only scoped commands without shell short-circuiting", async () => {
    expect(existsSync(verifierPath)).toBe(true)
    const { mcpIdeGateDefinitions } = await loadVerifier()

    const gates = mcpIdeGateDefinitions()
    expect(gates.map(gate => gate.id)).toEqual([
      "scoped-biome",
      "typecheck",
      "mcp-ide-tests",
      "build",
    ])
    for (const gate of gates) {
      const command = [gate.executable, ...gate.arguments].join(" ")
      expect(command).not.toContain("&&")
      expect(command).not.toMatch(/--write|--apply|lint-fix|format|check-fix/)
    }
  })
})
