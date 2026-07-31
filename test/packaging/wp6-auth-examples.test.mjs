import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { test } from "node:test"
import ts from "typescript"

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..")
const read = (relative) => readFileSync(path.join(root, relative), "utf8")

const importsOf = (relative) => {
  const source = ts.createSourceFile(relative, read(relative), ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
  return source.statements
    .filter(ts.isImportDeclaration)
    .map((statement) => statement.moduleSpecifier)
    .filter(ts.isStringLiteralLike)
    .map((specifier) => specifier.text)
}

test("Everything client is a public Effect authorization example with an explicit local-fixture policy", () => {
  const relative = "examples/everything-client.ts"
  const source = read(relative)
  const imports = importsOf(relative)

  assert.equal(imports.includes("mcp-effect-sdk/auth/client"), true)
  assert.equal(imports.includes("mcp-effect-sdk/client"), true)
  assert.equal(imports.includes("mcp-effect-sdk/transport/http"), true)
  assert.equal(imports.includes("mcp-effect-sdk"), false)
  assert.equal(
    imports.some((specifier) => specifier.startsWith("mcp-effect-sdk/auth/client/")),
    false
  )
  assert.equal(
    imports.some(
      (specifier) => specifier === "mcp-effect-sdk/auth/auth" || specifier === "mcp-effect-sdk/auth/providers"
    ),
    false
  )
  assert.match(source, /\bmakeAuthorizationClient\b|\blayerAuthorizationClient\b/)
  assert.match(source, /LOCAL_FIXTURE_ENDPOINT_POLICY\s*=\s*["']allow-loopback-http["']/)
  assert.doesNotMatch(source, /\bOAuth(?:Providers|Errors)?\b|\bauthProvider\b|\bwithOAuthRetry\b/)
  assert.match(source, /AuthorizationHttpClient/)
  assert.match(source, /AuthorizationCrypto/)
  assert.match(source, /AuthorizationInteraction/)
  assert.match(source, /AuthorizationClientStore/)
})

test("Everything server demonstrates the public protected-resource boundary without a deep auth import", () => {
  const relative = "examples/everything-server.ts"
  const source = read(relative)
  const imports = importsOf(relative)

  assert.equal(imports.includes("mcp-effect-sdk/auth/protected-resource"), true)
  assert.equal(
    imports.some((specifier) => specifier.startsWith("mcp-effect-sdk/auth/protected-resource/")),
    false
  )
  assert.match(source, /\bTokenVerifierService\b/)
  assert.match(source, /\bverifiedAuthorizationPrincipal\b/)
  assert.match(source, /\bmakeEverythingProtectedResourceOptions\b/)
  assert.doesNotMatch(source, /\bauthInfo\b/)
})

test("the active example ownership test recognizes both stable auth subpaths", () => {
  const ownership = read("test/packaging/wp5h-examples.test.mjs")
  assert.match(ownership, /["']mcp-effect-sdk\/auth\/client["']/)
  assert.match(ownership, /["']mcp-effect-sdk\/auth\/protected-resource["']/)
  assert.doesNotMatch(ownership, /rootNamespaces\s*=\s*new Set\(\[[^\]]*OAuth/s)
})
