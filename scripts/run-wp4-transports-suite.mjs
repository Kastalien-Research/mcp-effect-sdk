import { spawnSync } from "node:child_process"

const commands = [
  ["node", ["--test",
    "test/transports/wp4-transports.test.mjs",
    "test/packaging/wp4-package-boundary.test.mjs",
    "test/packaging/wp4-governance.test.mjs"
  ]],
  ["pnpm", ["exec", "tsc", "-p", "test/types/wp4-transports/tsconfig.json", "--noEmit"]],
  ["pnpm", ["exec", "tsc", "-p", "test/types/wp4-package-boundary/tsconfig.json", "--noEmit"]]
]

const failed = []
for (const [command, args] of commands) {
  const result = spawnSync(command, args, { stdio: "inherit" })
  if (result.status !== 0) failed.push(`${command} ${args.join(" ")}`)
}

if (failed.length > 0) {
  console.error("Cumulative Task 4D transport/package suite failed:")
  for (const command of failed) console.error(`- ${command}`)
  process.exit(1)
}
