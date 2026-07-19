import assert from "node:assert/strict"
import { existsSync, readFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const entrypoints = [
  "dist/client.d.ts",
  "dist/server.d.ts",
  "dist/protocol/2026-07-28.d.ts",
  "dist/client.js",
  "dist/server.js",
  "dist/protocol/2026-07-28.js"
]
const forbiddenDomNames = /\b(?:Window|Document|HTMLElement|MessageEvent)\b/
const forbiddenDomLib = /\blib=["']dom(?:\.iterable)?["']/i
const nodeBuiltin = /(?:from|import\s*\()\s*["'](?:node:|fs(?:\/|["'])|path["']|child_process["']|stream["']|http["']|https["'])/
const declarationImport = /(?:from\s+|import\s*\()\s*["']([^"']+)["']/g

const visited = new Set()
const pending = [...entrypoints]
while (pending.length > 0) {
  const relative = pending.pop()
  if (relative === undefined || visited.has(relative)) continue
  visited.add(relative)
  const absolute = path.join(root, relative)
  assert.equal(existsSync(absolute), true, `missing core output: ${relative}`)
  const source = readFileSync(absolute, "utf8")
  assert.doesNotMatch(source, forbiddenDomNames, `${relative} must be DOM-free`)
  assert.doesNotMatch(source, forbiddenDomLib, `${relative} must not reference the DOM library`)
  assert.doesNotMatch(source, nodeBuiltin, `${relative} must be Node-free`)
  for (const match of source.matchAll(declarationImport)) {
    const specifier = match[1]
    if (!specifier?.startsWith(".")) continue
    const resolved = path.posix.normalize(path.posix.join(path.posix.dirname(relative), specifier))
    pending.push(relative.endsWith(".d.ts")
      ? (resolved.endsWith(".js") ? `${resolved.slice(0, -3)}.d.ts` : `${resolved}.d.ts`)
      : resolved)
  }
}

console.log(`WP5B core emitted graphs are DOM/Node-free (${visited.size} files).`)
