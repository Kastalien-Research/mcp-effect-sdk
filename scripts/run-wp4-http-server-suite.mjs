import { spawnSync } from "node:child_process"

const commands = [
  ["node", ["--test", "test/http/wp4-http-server.test.mjs"]],
  ["node", ["scripts/check-wp4-http-server-types.mjs"]]
]

const failed = []
for (const [command, args] of commands) {
  const result = spawnSync(command, args, { stdio: "inherit" })
  if (result.status !== 0) failed.push(`${command} ${args.join(" ")}`)
}

if (failed.length > 0) {
  console.error("Task 4D HTTP server suite failed:")
  for (const command of failed) console.error(`- ${command}`)
  process.exit(1)
}
