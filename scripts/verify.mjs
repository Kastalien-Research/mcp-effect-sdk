import { spawnSync } from "node:child_process"

const commands = [
  ["pnpm", ["run", "check:sdk-workflow"]],
  ["pnpm", ["run", "check:generated"]],
  ["pnpm", ["run", "check:invariants"]],
  ["pnpm", ["run", "build"]],
  ["pnpm", ["run", "check:generated-protocol-surfaces"]],
  ["pnpm", ["run", "check:schema-fixtures"]],
  ["pnpm", ["run", "check:tasks"]],
  ["pnpm", ["run", "check:conformance-evidence"]],
  ["pnpm", ["run", "check:historical-mcp"]]
]

for (const [command, args] of commands) {
  const result = spawnSync(command, args, { stdio: "inherit" })
  if (result.status !== 0) {
    process.exit(result.status ?? 1)
  }
}
