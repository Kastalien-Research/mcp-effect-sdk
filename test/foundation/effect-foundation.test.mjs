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
  peerDependencies: { effect: "^3.22.0", "@effect/platform": "^0.97.0" },
  peerDependenciesMeta: { "@effect/platform": { optional: true } },
  devDependencies: {
    effect: "3.22.0",
    "@effect/platform-node": "0.108.0",
    "@effect/rpc": "0.76.0",
    "@types/node": "^22.0.0"
  },
  pnpm: {
    overrides: { "@effect/rpc": "0.76.0" }
  }
}

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..")

test("dependency policy accepts only the approved Effect 3 matrix", () => {
  assert.deepEqual(dependencyPolicyErrors(validPackage), [])
})

test("dependency policy fails closed for forbidden production and peer dependencies", () => {
  const invalid = structuredClone(validPackage)
  invalid.dependencies = { effect: "3.22.0", "@effect/rpc": "0.75.0" }
  invalid.peerDependencies["@effect/schema"] = "0.75.5"
  invalid.peerDependencies.extra = "1.0.0"
  invalid.devDependencies.effect = "^3.22.0"
  assert.ok(dependencyPolicyErrors(invalid).length >= 5)
})

test("dependency policy confines the platform-node RPC peer provider exactly", () => {
  for (const version of ["^0.76.0", "0.75.0", "latest"]) {
    const invalid = structuredClone(validPackage)
    invalid.devDependencies["@effect/rpc"] = version
    assert.ok(dependencyPolicyErrors(invalid).some((error) => error.includes("dev-only peer provider")))
  }

  const missingOverride = structuredClone(validPackage)
  delete missingOverride.pnpm.overrides["@effect/rpc"]
  assert.ok(dependencyPolicyErrors(missingOverride).some((error) => error.includes("pnpm override")))

  const schemaDevDependency = structuredClone(validPackage)
  schemaDevDependency.devDependencies["@effect/schema"] = "0.75.5"
  assert.ok(dependencyPolicyErrors(schemaDevDependency).some((error) => error.includes("@effect/schema")))
})

test("source policy rejects unstable, ServiceMap, fiber-internal, and Effect AI coupling", () => {
  const errors = sourcePolicyErrors([
    { file: "unstable.ts", source: 'import * as Rpc from "effect/unstable/rpc/Rpc"' },
    { file: "service.ts", source: 'import * as ServiceMap from "effect/ServiceMap"\nServiceMap.empty()' },
    { file: "fiber.ts", source: "Fiber.getCurrent()!.services" },
    { file: "ai.ts", source: "export const registerToolkit = (toolkit: Toolkit.Toolkit<any>) => toolkit" },
    { file: "rpc.ts", source: 'import type { RpcClientError } from "@effect/rpc/RpcClientError"' }
  ])
  assert.equal(errors.length, 6)
  assert.ok(errors.some((error) => error.includes("effect/unstable")))
  assert.ok(errors.some((error) => error.includes("ServiceMap")))
  assert.ok(errors.some((error) => error.includes("fiber-internal")))
  assert.ok(errors.some((error) => error.includes("Effect AI")))
  assert.ok(errors.some((error) => error.includes("@effect/rpc")))
})

test("source policy permits stable Effect 3 modules and MCP Tool names", () => {
  assert.deepEqual(sourcePolicyErrors([{ file: "ok.ts", source: 'import * as Context from "effect/Context"\nexport interface Tool {}' }]), [])
})

test("tracked source collection covers scratch paths outside src and scripts", () => {
  const files = collectSourceFiles(root)
  assert.ok(files.some(({ file }) => file === "scratch/ad-hoc-scripts/inspect-rpc.js"))
})

test("single-runtime policy rejects zero, multiple, and wrong Effect runtimes", () => {
  assert.equal(lockfileRuntimeErrors("lockfileVersion: '9.0'\n").length, 1)
  assert.equal(lockfileRuntimeErrors("  effect@4.0.0:\n").length, 1)
  assert.equal(lockfileRuntimeErrors("  effect@3.22.0:\n  effect@3.21.0:\n").length, 1)
  assert.deepEqual(lockfileRuntimeErrors("  effect@3.22.0:\n"), [])
})

test("workflow policy requires both Node release lanes and matrix consumption", () => {
  assert.equal(workflowPolicyErrors("node-version: '22'").length, 1)
  assert.equal(workflowPolicyErrors("matrix:\n  node: [22, 24]\nnode-version: 22").length, 1)
  assert.deepEqual(
    workflowPolicyErrors("matrix:\n  node: [22, 24]\nnode-version: ${{ matrix.node }}\npnpm install --frozen-lockfile --strict-peer-dependencies"),
    []
  )
  assert.equal(
    workflowPolicyErrors("matrix:\n  node: [22, 24]\nnode-version: ${{ matrix.node }}\npnpm install --frozen-lockfile").length,
    1
  )
})
