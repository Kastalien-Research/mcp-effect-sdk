import assert from "node:assert/strict"
import { readdirSync, readFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"
import { test } from "node:test"

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..")
const spansSourcePath = path.join(root, "src/observability/Spans.ts")
let spansDist

const spansSource = readFileSync(spansSourcePath, "utf8")
let loadError
try {
  spansDist = await import(pathToFileURL(path.join(root, "dist/observability/Spans.js")).href)
} catch (error) {
  loadError = error
}

function requireSpansModule() {
  assert.ifError(loadError)
}

function collectSources(baseDirectory, extensions = new Set([".ts", ".mts", ".cts"])) {
  const sources = []
  for (const entry of readdirSync(baseDirectory, { withFileTypes: true })) {
    const absolute = path.join(baseDirectory, entry.name)
    if (entry.isDirectory()) {
      if (entry.name === "dist" || entry.name === "repos") {
        continue
      }
      sources.push(...collectSources(absolute, extensions))
      continue
    }
    if (!extensions.has(path.extname(entry.name))) continue
    sources.push(absolute)
  }
  return sources
}

function readSdkSources() {
  return collectSources(path.join(root, "src"))
    .filter((file) => file !== spansSourcePath)
    .map((file) => readFileSync(file, "utf8"))
    .join("\n")
}

test("Spans.ts exports a request-id helper with canonical missing-id normalization", () => {
  requireSpansModule()
  assert.equal(
    spansSource.includes("export const requestIdAttribute"),
    true,
    "requestIdAttribute helper must be exported"
  )
  assert.equal(spansDist.requestIdAttribute(undefined), "(none)")
  assert.equal(spansDist.requestIdAttribute(null), "(none)")
  assert.equal(spansDist.requestIdAttribute(123), "123")
  assert.equal(spansDist.requestIdAttribute("request-7"), "request-7")
})

test("Span catalogs are deduplicated and complete", () => {
  requireSpansModule()
  const spanNames = Object.values(spansDist.SpanName)
  const spanAttributes = Object.values(spansDist.SpanAttribute)

  assert.equal(new Set(spanNames).size, spanNames.length, "span names must be unique")
  assert.equal(new Set(spanAttributes).size, spanAttributes.length, "span attributes must be unique")
  assert.equal(
    spanNames.every((value) => typeof value === "string" && value.length > 0),
    true,
    "span names must be non-empty strings"
  )
  assert.equal(
    spanAttributes.every((value) => typeof value === "string" && value.length > 0),
    true,
    "span attributes must be non-empty strings"
  )
})

test("Span name and attribute registries are protocol-namespaced and cover required kinds", () => {
  requireSpansModule()
  const spanNames = Object.values(spansDist.SpanName)
  const attributeNames = Object.values(spansDist.SpanAttribute)

  assert.equal(spanNames.length > 0, true, "public span names must be non-empty")
  assert.equal(attributeNames.length > 0, true, "public span attributes must be non-empty")
  assert.equal(
    spanNames.every((value) => typeof value === "string" && value.startsWith("mcp.")),
    true,
    "every public span name must be mcp namespaced"
  )
  assert.equal(
    attributeNames.every((value) => typeof value === "string" && value.startsWith("mcp.")),
    true,
    "every public span attribute should be mcp namespaced"
  )

  for (const kind of ["client", "server", "transport", "auth"]) {
    assert.equal(
      spanNames.some((value) => value.startsWith(`mcp.${kind}.`)),
      true,
      `span names should include at least one ${kind} kind`
    )
  }

  assert.equal(
    spansSource.includes("requestIdAttribute"),
    true,
    "source should expose request-id helper implementation"
  )
  assert.equal(spansSource.includes("SpanAttribute"), true, "source should expose attribute catalog")
  assert.equal(spansSource.includes("SpanName"), true, "source should expose span name catalog")
})

test("public span names have callsites outside their own declaration module", () => {
  requireSpansModule()
  const source = readSdkSources()
  const spanEntries = Object.entries(spansDist.SpanName)

  for (const [key, name] of spanEntries) {
    assert.equal(
      source.includes(`SpanName.${key}`) || (source.includes("SpanName[span]") && source.includes(`"${key}"`)),
      true,
      `span ${name} should have an SDK instrumentation callsite outside Spans.ts`
    )
  }
})

test("SDK span catalog does not emit raw URI attribute and avoids captureStackTrace true", () => {
  requireSpansModule()
  const source = readSdkSources()

  assert.equal(
    Object.hasOwn(spansDist.SpanAttribute, "resourceUri"),
    false,
    "the public catalog must not expose raw URIs"
  )
  assert.equal(source.includes('"mcp.uri"'), false, "SDK sources must not emit mcp.uri")
  assert.equal(
    source.includes("captureStackTrace: true"),
    false,
    "SDK span options should not enable captureStackTrace"
  )
})
