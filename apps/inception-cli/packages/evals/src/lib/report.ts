import { mkdirSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const pkgRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..")

export function writeProbeReport(
  name: string,
  data: unknown,
  host = "api.inceptionlabs.ai"
): string {
  const path = join(pkgRoot, "fixtures", "probes", `${name}.json`)
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(
    path,
    JSON.stringify(
      {
        probe: name,
        capturedAt: new Date().toISOString(),
        baseUrlHost: host,
        data
      },
      null,
      2
    )
  )
  return path
}
