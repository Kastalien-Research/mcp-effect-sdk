import { spawnSync } from "node:child_process"
import path from "node:path"
import { fileURLToPath } from "node:url"

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const result = spawnSync("pnpm", ["exec", "tsc", "--project", "test/types/wp4-http-client/tsconfig.json"], {
  cwd: root,
  encoding: "utf8"
})

if (result.status !== 0) {
  process.stdout.write(result.stdout)
  process.stderr.write(result.stderr)
  console.error("Task 4D public HTTP client type fixture failed to compile.")
  process.exit(1)
}

console.log("Task 4D public HTTP client type fixture passes.")
