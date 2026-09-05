import assert from "node:assert/strict"
import path from "node:path"
import { test } from "node:test"
import { fileURLToPath } from "node:url"
import {
  collectSourceFiles,
  dependencyPolicyErrors,
  lockfileRuntimeErrors,
  sourcePolicyErrors,
  workflowPolicyErrors
} from "../../scripts/effect-foundation-policy.mjs"

const validPackage = {
  engines: { node: "^22.0.0 || ^24.0.0" },
  dependencies: {},
  peerDependencies: { effect: "4.0.0-rc.112" },
  devDependencies: {
    effect: "4.0.0-rc.112",
    "@effect/platform-node": "4.0.0-rc.112",
    "@types/node": "^22.0.0"
  }
}

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..")

test("dependency policy accepts only the approved Effect 4 RC matrix", () => {
  assert.deepEqual(dependencyPolicyErrors(validPackage), [])
})

test("dependency policy fails closed for forbidden production and peer dependencies", () => {
  const invalid = structuredClone(validPackage)
  invalid.dependencies = { effect: "3.22.0", "@effect/rpc": "0.75.0" }
  invalid.peerDependencies["@effect/schema"] = "0.75.5"
  invalid.peerDependencies.extra = "1.0.0"
  invalid.devDependencies.effect = "^4.0.0-rc.112"
  assert.ok(dependencyPolicyErrors(invalid).length >= 5)
})

test("dependency policy removes consolidated packages and requires matching RC pins", () => {
  for (const name of ["@effect/schema", "@effect/platform", "@effect/rpc"]) {
    const invalid = structuredClone(validPackage)
    invalid.devDependencies[name] = "0.76.0"
    assert.ok(dependencyPolicyErrors(invalid).some((error) => error.includes(name)))
  }
  const oldOverride = structuredClone(validPackage)
  oldOverride.pnpm = { overrides: { "@effect/rpc": "0.76.0" } }
  assert.ok(dependencyPolicyErrors(oldOverride).some((error) => error.includes("obsolete pnpm override")))
  const mismatchedNode = structuredClone(validPackage)
  mismatchedNode.devDependencies["@effect/platform-node"] = "4.0.0-rc.111"
  assert.ok(dependencyPolicyErrors(mismatchedNode).some((error) => error.includes("platform-node")))
})

test("source policy rejects obsolete packages, ServiceMap, and fiber-internal access", () => {
  const errors = sourcePolicyErrors([
    { file: "platform.ts", source: 'import * as HttpRouter from "@effect/platform/HttpRouter"' },
    { file: "service.ts", source: 'import * as ServiceMap from "effect/ServiceMap"\nServiceMap.empty()' },
    { file: "fiber.ts", source: "Fiber.getCurrent()!.services" },
    { file: "rpc.ts", source: 'import type { RpcClientError } from "@effect/rpc/RpcClientError"' }
  ])
  assert.equal(errors.length, 5)
  for (const label of ["@effect/platform", "ServiceMap", "fiber-internal", "@effect/rpc"]) {
    assert.ok(errors.some((error) => error.includes(label)))
  }
})

test("source policy permits Effect 4 consolidated HTTP, RPC, AI, and MCP modules", () => {
  assert.deepEqual(
    sourcePolicyErrors([
      { file: "ok.ts", source: 'import * as Context from "effect/Context"\nexport interface Tool {}' },
      { file: "http.ts", source: 'import * as HttpRouter from "effect/unstable/http/HttpRouter"' },
      { file: "rpc.ts", source: 'import * as Rpc from "effect/unstable/rpc/Rpc"' },
      { file: "ai.ts", source: 'import * as McpServer from "effect/unstable/ai/McpServer"' }
    ]),
    []
  )
})

test("tracked source collection reaches beyond src and scripts", () => {
  const files = collectSourceFiles(root)
  assert.ok(
    files.some(({ file }) => !file.startsWith("src/") && !file.startsWith("scripts/")),
    "source policy must scan every tracked source file, not just src/ and scripts/"
  )
})

test("single-runtime policy rejects zero, multiple, and wrong Effect runtimes", () => {
  assert.equal(lockfileRuntimeErrors("lockfileVersion: '9.0'\n").length, 1)
  assert.equal(lockfileRuntimeErrors("  effect@4.0.0:\n").length, 1)
  assert.equal(lockfileRuntimeErrors("  effect@4.0.0-rc.112:\n  effect@3.22.0:\n").length, 1)
  assert.deepEqual(lockfileRuntimeErrors("  effect@4.0.0-rc.112:\n"), [])
})

test("workflow policy requires a canonical Node 22 Tier lane and a Node 24 package-health lane", () => {
  assert.ok(
    workflowPolicyErrors("  tier-node22:\n    node-version: 22\n").some((error) => error.includes("Node 22 Tier"))
  )
  assert.deepEqual(
    workflowPolicyErrors(
      [
        "jobs:",
        "  tier-node22:",
        "    node-version: 22",
        "    run: pnpm install --frozen-lockfile --strict-peer-dependencies",
        "    run: pnpm run verify",
        "  package-health-node24:",
        "    node-version: 24",
        "    run: pnpm install --frozen-lockfile --strict-peer-dependencies",
        "    run: node scripts/verify.mjs --package-health"
      ].join("\n")
    ),
    []
  )
  assert.ok(
    workflowPolicyErrors(
      [
        "jobs:",
        "  tier-node22:",
        "    node-version: 22",
        "    run: pnpm install --frozen-lockfile",
        "    run: pnpm run verify",
        "  package-health-node24:",
        "    node-version: 24",
        "    run: pnpm install --frozen-lockfile --strict-peer-dependencies",
        "    run: node scripts/verify.mjs --package-health"
      ].join("\n")
    ).some((error) => error.includes("Node 22 Tier workflow install"))
  )
})
