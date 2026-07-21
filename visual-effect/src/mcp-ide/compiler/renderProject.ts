import { Effect } from "effect"
import {
  type CompilerBackend,
  effectScaffoldV1,
  type McpGeneratedFile,
  McpProjectRenderError,
} from "./CompilerBackend"
import { compareCodePoints, type McpProject, type McpProjectSource } from "./McpProject"

export const RENDERED_MCP_PROJECT_SCHEMA_VERSION = "1" as const

export interface RenderedMcpProject {
  readonly schemaVersion: typeof RENDERED_MCP_PROJECT_SCHEMA_VERSION
  readonly kind: "rendered-mcp-project"
  readonly backend: { readonly id: string; readonly version: string }
  readonly source: McpProjectSource
  readonly files: ReadonlyArray<McpGeneratedFile>
}

const outputIssue = (code: string, explanation: string) => ({
  code,
  severity: "error" as const,
  path: "files",
  explanation,
  repairs: [{ id: "fix-backend-output", label: "Use fixed unique repository-relative paths" }],
})

const isSafePath = (path: string): boolean => {
  if (path.length === 0 || path.startsWith("/")) return false
  const segments = path.split("/")
  return segments.every(
    segment =>
      segment.length > 0 &&
      segment !== "." &&
      segment !== ".." &&
      /^[A-Za-z0-9._-]+$/.test(segment),
  )
}

const validateFiles = (
  backendId: string,
  files: ReadonlyArray<McpGeneratedFile>,
): Effect.Effect<ReadonlyArray<McpGeneratedFile>, McpProjectRenderError> => {
  const paths = files.map(file => file.path)
  const issues = []
  if (paths.some(path => !isSafePath(path))) {
    issues.push(outputIssue("unsafe-generated-path", "The backend returned an unsafe file path"))
  }
  if (new Set(paths).size !== paths.length) {
    issues.push(
      outputIssue("duplicate-generated-path", "The backend returned duplicate file paths"),
    )
  }
  if (
    paths.some((path, index) => index > 0 && compareCodePoints(paths[index - 1] ?? "", path) > 0)
  ) {
    issues.push(
      outputIssue("unsorted-generated-path", "The backend returned files outside code-point order"),
    )
  }
  return issues.length > 0
    ? Effect.fail(new McpProjectRenderError({ backendId, issues }))
    : Effect.succeed(files)
}

export const renderProject = (
  project: McpProject,
  backend: CompilerBackend = effectScaffoldV1,
): Effect.Effect<RenderedMcpProject, McpProjectRenderError> =>
  Effect.gen(function* () {
    const backendEffect = yield* Effect.try({
      try: () => backend.render(project),
      catch: () =>
        new McpProjectRenderError({
          backendId: backend.id,
          issues: [
            {
              code: "backend-invocation-failed",
              severity: "error",
              path: "backend",
              explanation: "The backend could not be invoked",
              repairs: [{ id: "select-backend", label: "Select a functioning backend" }],
            },
          ],
        }),
    })
    const files = yield* backendEffect
    const acceptedFiles = yield* validateFiles(backend.id, files)
    return {
      schemaVersion: "1",
      kind: "rendered-mcp-project",
      backend: { id: backend.id, version: backend.version },
      source: project.source,
      files: acceptedFiles,
    }
  })
