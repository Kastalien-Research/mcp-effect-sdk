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
  const relative = "src/examples/everything-client.ts"
  const source = read(relative)
  const imports = importsOf(relative)

  assert.equal(imports.includes("../auth/client.js"), true)
  assert.equal(imports.includes("../client.js"), true)
  assert.equal(imports.includes("../transport/http.js"), true)
  assert.equal(imports.includes("../index.js"), false)
  assert.equal(imports.some((specifier) => specifier.startsWith("../auth/client/")), false)
  assert.equal(imports.some((specifier) => specifier === "../auth/auth.js" || specifier === "../auth/providers.js"), false)
  assert.match(source, /\bmakeAuthorizationClient\b|\blayerAuthorizationClient\b/)
  assert.match(source, /LOCAL_FIXTURE_ENDPOINT_POLICY\s*=\s*["']allow-loopback-http["']/)
  assert.doesNotMatch(source, /\bOAuth(?:Providers|Errors)?\b|\bauthProvider\b|\bwithOAuthRetry\b/)
  assert.match(source, /AuthorizationHttpClient/)
  assert.match(source, /AuthorizationCrypto/)
  assert.match(source, /AuthorizationInteraction/)
  assert.match(source, /AuthorizationClientStore/)
})

test("Everything server demonstrates the public protected-resource boundary without a deep auth import", () => {
  const relative = "src/examples/everything-server.ts"
  const source = read(relative)
  const imports = importsOf(relative)

  assert.equal(imports.includes("../auth/protected-resource.js"), true)
  assert.equal(imports.some((specifier) => specifier.startsWith("../auth/protected-resource/")), false)
  assert.match(source, /\bTokenVerifierService\b/)
  assert.match(source, /\bverifiedAuthorizationPrincipal\b/)
  assert.match(source, /\bmakeEverythingProtectedResourceOptions\b/)
  assert.doesNotMatch(source, /\bauthInfo\b/)
})

test("the active example ownership test recognizes both stable auth subpaths", () => {
  const ownership = read("test/packaging/wp5h-examples.test.mjs")
  assert.match(ownership, /["']\.\.\/auth\/client\.js["']/)
  assert.match(ownership, /["']\.\.\/auth\/protected-resource\.js["']/)
  assert.doesNotMatch(ownership, /rootNamespaces\s*=\s*new Set\(\[[^\]]*OAuth/s)
})
