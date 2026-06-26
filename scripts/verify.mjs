import { spawnSync } from "node:child_process"

const commands = [
  ["pnpm", ["run", "check:sdk-workflow"]],
  ["pnpm", ["run", "check:generated"]],
  ["pnpm", ["run", "check:invariants"]],
  ["pnpm", ["run", "build"]],
  ["pnpm", ["run", "check:sdk-runtime"]],
  ["pnpm", ["run", "check:generated-protocol-surfaces"]],
  ["pnpm", ["run", "check:schema-fixtures"]],
  // check:tasks removed: core tasks left the protocol in MCP 2026-07-28 and
  // become the io.modelcontextprotocol/tasks extension (tracked in #15).
  ["pnpm", ["run", "check:extensions"]],
  ["pnpm", ["run", "check:conformance-evidence"]],
  ["pnpm", ["run", "check:historical-mcp"]],
  ["pnpm", ["run", "test:unit"]],
  ["pnpm", ["run", "test:integration"]],
  ["pnpm", ["run", "test:e2e"]],
  // The external client-auth conformance gate was removed from verify: the
  // external @modelcontextprotocol/conformance auth tool only supports the
  // 2025-* protocol versions and performs an `initialize` handshake, so it
  // cannot speak the MCP 2026-07-28 stateless draft. The npm script is retained
  // for manual use. Draft auth conformance needs upstream support (tracked in
  // issues #19 / #20). The e2e gate above is now the self-hosted draft
  // round-trip (test:e2e -> run-draft-e2e.mjs).
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
