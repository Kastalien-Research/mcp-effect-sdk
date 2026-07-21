import { spawnSync } from "node:child_process"

const commands = [
  ["pnpm", ["run", "conformance:run"]],
  ["pnpm", ["run", "conformance:client"]],
  ["pnpm", ["run", "conformance:client-auth"]]
]

const failed = []
for (const [command, args] of commands) {
  const result = spawnSync(command, args, { stdio: "inherit" })
  if (result.status !== 0) failed.push(`${command} ${args.join(" ")}`)
}

if (failed.length > 0) {
  console.error("\nAuthoritative conformance failed gates:")
  for (const command of failed) console.error(`- ${command}`)
  process.exit(1)
}
