import { spawnSync } from "node:child_process"

const commands = [
  ["pnpm", ["run", "sources:check"]],
  ["pnpm", ["run", "lint"]],
  ["pnpm", ["run", "test:effect-foundation"]],
  ["pnpm", ["run", "test:script-libraries"]],
  ["pnpm", ["run", "check:effect-foundation"]],
  ["pnpm", ["run", "check:sdk-workflow"]],
  ["pnpm", ["run", "check:generated"]],
  ["pnpm", ["run", "check:invariants"]],
  ["pnpm", ["run", "build"]],
  // Must follow `build`: `examples/**` import the SDK by package name, which
  // resolves through `exports` into `dist/`. Run before the build and every
  // example resolves to nothing, so the language service reports the SDK's
  // services as `missingEffectContext` against an `unknown` context.
  ["pnpm", ["run", "check:effect-lsp"]],
  ["pnpm", ["run", "check:ts-sdk-parity"]],
  ["pnpm", ["run", "test:conformance-contradictions"]],
  ["pnpm", ["run", "test:schema-codecs"]],
  ["pnpm", ["run", "test:protocol-metadata"]],
  ["pnpm", ["run", "test:wire"]],
  ["pnpm", ["run", "test:dispatcher"]],
  ["pnpm", ["run", "test:stdio"]],
  ["pnpm", ["run", "test:http-metadata"]],
  ["pnpm", ["run", "test:http"]],
  ["pnpm", ["run", "test:transports"]],
  ["pnpm", ["run", "test:core"]],
  ["pnpm", ["run", "test:auth"]],
  ["pnpm", ["run", "check:type-fixtures"]],
  ["pnpm", ["run", "test:regressions"]],
  ["pnpm", ["run", "check:sdk-runtime"]],
  ["pnpm", ["run", "check:generated-protocol-surfaces"]],
  ["pnpm", ["run", "check:schema-fixtures"]],
  // check:tasks removed: core tasks left the protocol in MCP 2026-07-28 and
  // become the io.modelcontextprotocol/tasks extension (tracked in #15).
  ["pnpm", ["run", "check:extensions"]],
  ["pnpm", ["run", "check:conformance-evidence"]],
  ["pnpm", ["run", "check:agent-evidence"]],
  ["pnpm", ["run", "check:historical-mcp"]],
  ["pnpm", ["run", "test:source-refresh"]],
  ["pnpm", ["run", "test:tier-operations"]],
  ["pnpm", ["run", "check:tier-operations"]],
  ["pnpm", ["run", "check:tier-relegation"]],
  ["pnpm", ["run", "test:unit"]],
  ["pnpm", ["run", "test:integration"]],
  ["pnpm", ["run", "test:e2e"]],
  ["pnpm", ["run", "e2e:draft"]],
  ["pnpm", ["run", "verify:conformance"]],
  ["pnpm", ["run", "check:tier-protocol-features"]],
  ["pnpm", ["run", "check:sdk-readiness"]]
]

const failed = []

for (const [command, args] of commands) {
  const result = spawnSync(command, args, { stdio: "inherit" })
  if (result.status !== 0) {
    failed.push(`${command} ${args.join(" ")}`)
  }
}

if (failed.length > 0) {
  console.error("")
  console.error("Verify failed gates:")
  for (const command of failed) {
    console.error(`- ${command}`)
  }
  process.exit(1)
}
