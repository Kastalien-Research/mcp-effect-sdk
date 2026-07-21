import { spawnSync } from "node:child_process"

const commands = [
  ["node", ["--test", "test/wire/wp4-wire.test.mjs"]],
  ["node", ["scripts/check-wp4-wire-types.mjs"]]
]

const failed = []
for (const [command, args] of commands) {
  const result = spawnSync(command, args, { stdio: "inherit" })
  if (result.status !== 0) failed.push(`${command} ${args.join(" ")}`)
}

if (failed.length > 0) {
  console.error("Task 4A wire suite failed:")
  for (const command of failed) console.error(`- ${command}`)
  process.exit(1)
}
