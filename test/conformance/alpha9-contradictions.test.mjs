import assert from "node:assert/strict"
import { createRequire } from "node:module"
import { readFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"
import { test } from "node:test"
import Ajv2020 from "ajv/dist/2020.js"
import addFormats from "ajv-formats"

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..")
const readJson = (filePath) => JSON.parse(readFileSync(filePath, "utf8"))
const coreSchema = readJson(path.join(root, "sources/vendor/mcp-core/schema.json"))
const require = createRequire(import.meta.url)
const conformancePackagePath = require.resolve("@modelcontextprotocol/conformance/package.json")
const conformanceRoot = path.dirname(conformancePackagePath)
const conformancePackage = readJson(conformancePackagePath)
const conformanceSource = readFileSync(path.join(conformanceRoot, "dist/index.js"), "utf8")
const conformanceRequire = createRequire(conformancePackagePath)
const embeddedSdkExportedPackagePath = conformanceRequire.resolve(
  "@modelcontextprotocol/sdk/package.json"
)
const embeddedSdkRoot = path.resolve(path.dirname(embeddedSdkExportedPackagePath), "../..")
const embeddedSdkPackagePath = path.join(embeddedSdkRoot, "package.json")
const embeddedSdkPackage = readJson(embeddedSdkPackagePath)

const compileDefinition = (name) => {
  const ajv = new Ajv2020({ strict: false })
  addFormats(ajv)
  return ajv.compile({
    $schema: coreSchema.$schema,
    $defs: coreSchema.$defs,
    ...coreSchema.$defs[name]
  })
}

test("alpha.9 promotes optional request clientInfo to a required field", () => {
  assert.equal(conformancePackage.version, "0.2.0-alpha.9")

  const requestMeta = coreSchema.$defs.RequestMetaObject
  assert.deepEqual(requestMeta.required, [
    "io.modelcontextprotocol/clientCapabilities",
    "io.modelcontextprotocol/protocolVersion"
  ])
  assert.equal(requestMeta.required.includes("io.modelcontextprotocol/clientInfo"), false)

  const specConformingMetaWithoutClientInfo = {
    "io.modelcontextprotocol/clientCapabilities": {},
    "io.modelcontextprotocol/protocolVersion": "2026-07-28"
  }
  const validate = compileDefinition("RequestMetaObject")
  assert.equal(validate(specConformingMetaWithoutClientInfo), true, JSON.stringify(validate.errors))

  assert.match(
    conformanceSource,
    /slug:`missing-client-info`,description:`Rejects request with _meta missing io\.modelcontextprotocol\/clientInfo`/
  )
  assert.match(conformanceSource, /`sep-2575-request-meta-invalid-\$\{e\.slug\}`/)
  assert.match(conformanceSource, /`sep-2575-http-server-meta-invalid-400`/)
  assert.match(conformanceSource, /Expected error code -32602/)
  assert.match(conformanceSource, /Expected HTTP 400 Bad Request/)
})

test("alpha.9 checks serverInfo at the wrong DiscoverResult location", () => {
  const discoverResult = coreSchema.$defs.DiscoverResult
  assert.equal(Object.hasOwn(discoverResult.properties, "serverInfo"), false)
  assert.equal(
    Object.hasOwn(coreSchema.$defs.ResultMetaObject.properties, "io.modelcontextprotocol/serverInfo"),
    true
  )

  const specConformingDiscoverResult = {
    resultType: "complete",
    ttlMs: 0,
    cacheScope: "private",
    supportedVersions: ["2026-07-28"],
    capabilities: { tools: {} },
    _meta: {
      "io.modelcontextprotocol/serverInfo": {
        name: "contradiction-reproducer",
        version: "1.0.0"
      }
    }
  }
  const validate = compileDefinition("DiscoverResult")
  assert.equal(validate(specConformingDiscoverResult), true, JSON.stringify(validate.errors))
  assert.equal(Object.hasOwn(specConformingDiscoverResult, "serverInfo"), false)

  const scenarioStart = conformanceSource.indexOf("`sep-2575-server-implements-discover`")
  assert.notEqual(scenarioStart, -1)
  const scenarioSource = conformanceSource.slice(scenarioStart, scenarioStart + 800)
  assert.match(scenarioSource, /!m\?\.serverInfo/)
  assert.match(scenarioSource, /Missing mandatory fields in discover response setup/)
})

test("alpha.9 advertises 2026-07-28 through an SDK that cannot negotiate it", async () => {
  assert.equal(embeddedSdkPackage.version, "1.29.0")
  const embeddedTypesPath = path.join(embeddedSdkRoot, "dist/esm/types.js")
  const embeddedTypes = await import(pathToFileURL(embeddedTypesPath).href)
  assert.equal(embeddedTypes.LATEST_PROTOCOL_VERSION, "2025-11-25")
  assert.equal(embeddedTypes.SUPPORTED_PROTOCOL_VERSIONS.includes("2026-07-28"), false)

  const scenarioStart = conformanceSource.indexOf("name=`json-schema-ref-no-deref`")
  assert.notEqual(scenarioStart, -1)
  const scenarioSource = conformanceSource.slice(scenarioStart, scenarioStart + 9000)
  assert.match(scenarioSource, /supportedVersions:\[k\]/)
  assert.match(scenarioSource, /new v\(\{sessionIdGenerator:void 0\}\)/)
  assert.match(conformanceSource.slice(0, 3500), /k=`2026-07-28`/)

  const advertisedVersions = ["2026-07-28"]
  const negotiableVersions = advertisedVersions.filter((version) =>
    embeddedTypes.SUPPORTED_PROTOCOL_VERSIONS.includes(version)
  )
  assert.deepEqual(negotiableVersions, [])
})
