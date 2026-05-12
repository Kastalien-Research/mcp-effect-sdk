import { spawnSync } from "node:child_process"

const commands = [
  ["pnpm", ["run", "check:sdk-workflow"]],
  ["pnpm", ["run", "check:generated"]],
  ["pnpm", ["run", "check:invariants"]],
  ["pnpm", ["run", "check:ts-sdk-parity"]],
  ["pnpm", ["run", "build"]],
  ["pnpm", ["run", "check:sdk-runtime"]],
  ["pnpm", ["run", "check:generated-protocol-surfaces"]],
  ["pnpm", ["run", "check:schema-fixtures"]],
  ["pnpm", ["run", "check:tasks"]],
  ["pnpm", ["run", "check:extensions"]],
  ["pnpm", ["run", "check:conformance-evidence"]],
  ["pnpm", ["run", "check:historical-mcp"]],
  ["pnpm", ["run", "test:unit"]],
  ["pnpm", ["run", "test:integration"]],
  ["pnpm", ["run", "test:e2e"]],
  ["pnpm", ["run", "conformance:client-auth"]],
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
