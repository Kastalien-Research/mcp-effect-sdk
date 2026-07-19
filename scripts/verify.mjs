import { spawnSync } from "node:child_process"

const commands = [
  ["pnpm", ["run", "sources:check"]],
  ["pnpm", ["run", "test:effect-foundation"]],
  ["pnpm", ["run", "check:effect-foundation"]],
  ["pnpm", ["run", "check:sdk-workflow"]],
  ["pnpm", ["run", "check:generated"]],
  ["pnpm", ["run", "check:invariants"]],
  ["pnpm", ["run", "build"]],
  ["pnpm", ["run", "check:ts-sdk-parity"]],
  ["pnpm", ["run", "test:wp3-schema"]],
  ["pnpm", ["run", "test:wp3-protocol"]],
  ["pnpm", ["run", "test:wp4-wire"]],
  ["pnpm", ["run", "test:wp4-dispatcher"]],
  ["pnpm", ["run", "test:wp4-stdio"]],
  ["pnpm", ["run", "test:wp4-http-metadata"]],
  ["pnpm", ["run", "test:wp4-http"]],
  ["pnpm", ["run", "test:wp4-transports"]],
  ["pnpm", ["run", "test:wp5-core"]],
  ["pnpm", ["run", "check:type-fixtures"]],
  ["pnpm", ["run", "test:wp2-review"]],
  ["pnpm", ["run", "check:sdk-runtime"]],
  ["pnpm", ["run", "check:generated-protocol-surfaces"]],
  ["pnpm", ["run", "check:schema-fixtures"]],
  // check:tasks removed: core tasks left the protocol in MCP 2026-07-28 and
  // become the io.modelcontextprotocol/tasks extension (tracked in #15).
  ["pnpm", ["run", "check:extensions"]],
  ["pnpm", ["run", "check:conformance-evidence"]],
  ["pnpm", ["run", "check:historical-mcp"]],
  ["pnpm", ["run", "test:source-refresh"]],
  ["pnpm", ["run", "test:tier-operations"]],
  ["pnpm", ["run", "check:tier-operations"]],
  ["pnpm", ["run", "test:unit"]],
  ["pnpm", ["run", "test:integration"]],
  ["pnpm", ["run", "test:e2e"]],
  ["pnpm", ["run", "e2e:draft"]],
  // Package-health verification stays green on local draft e2e. MCP readiness
  // qualification remains blocked until the draft-targeted official
  // conformance path (`pnpm run conformance:run`) passes or records an exact
  // upstream/tool blocker.
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
