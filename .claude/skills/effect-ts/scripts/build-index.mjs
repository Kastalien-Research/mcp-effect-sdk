#!/usr/bin/env node
/**
 * build-index.mjs
 *
 * Builds a semantic search index over the VENDORED EFFECT SOURCE AND TESTS
 * (repos/effect), not over prose documentation.
 *
 * Why: docs explain what an API does; they do not show how it is used. The
 * `test/` trees are the densest source of idiomatic Effect in existence, and
 * npm does not ship them — which is the whole reason repos/effect exists.
 * Indexing them makes "find me a real call site" a one-command operation across
 * ~900 files.
 *
 * The index is a RETRIEVAL AID, not the answer. Results carry file:line so the
 * consumer opens the real file.
 *
 * Usage:
 *   VOYAGE_API_KEY=... node .claude/skills/effect-ts/scripts/build-index.mjs
 *
 * Options:
 *   --scope <s>   core | installed | all   (default: installed)
 *                   core      — packages/effect only
 *                   installed — packages this repo actually depends on
 *                   all       — every package in the monorepo (expensive)
 *   --with-src    Also index implementation source. Off by default: measured at
 *                 `installed` scope, src contributes 14,282 of 16,793 chunks
 *                 (~4M tokens vs ~877k for tests alone) while being the part
 *                 you can already reach precisely by name with ripgrep. Tests
 *                 are the part worth searching semantically, because you query
 *                 them by intent ("retry with backoff") rather than by symbol.
 *   --dry-run     Chunk and report counts without calling the embedding API
 *
 * Env:
 *   VOYAGE_MODEL  — embedding model (default: voyage-3.5-lite)
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync, statSync } from "node:fs"
import { dirname, join, relative } from "node:path"
import { fileURLToPath } from "node:url"

function loadEnv() {
  const envPath = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..", ".env")
  if (!existsSync(envPath)) return
  for (const line of readFileSync(envPath, "utf-8").split("\n")) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith("#")) continue
    const eqIdx = trimmed.indexOf("=")
    if (eqIdx === -1) continue
    const key = trimmed.slice(0, eqIdx).trim()
    if (!process.env[key]) process.env[key] = trimmed.slice(eqIdx + 1).trim()
  }
}
loadEnv()

const __dirname = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = join(__dirname, "..", "..", "..", "..")
const DATA_DIR = join(__dirname, "..", "data")
const INDEX_PATH = join(DATA_DIR, "index.json")
const EFFECT_ROOT = join(REPO_ROOT, "repos", "effect", "packages")

const VOYAGE_API_KEY = process.env.VOYAGE_API_KEY
const VOYAGE_MODEL = process.env.VOYAGE_MODEL || "voyage-3.5-lite"
const VOYAGE_URL = "https://api.voyageai.com/v1/embeddings"

const MAX_CHUNK_CHARS = 2000
const MIN_CHUNK_CHARS = 80

/** Packages this repo actually depends on. Keep in sync with package.json. */
const INSTALLED = ["effect", "platform", "platform-node", "rpc"]

// --- args ---
const argv = process.argv.slice(2)
const testsOnly = !argv.includes("--with-src")
const dryRun = argv.includes("--dry-run")
const scopeIdx = argv.indexOf("--scope")
const scope = scopeIdx !== -1 ? argv[scopeIdx + 1] : "installed"

function resolvePackages() {
  if (!existsSync(EFFECT_ROOT)) {
    console.error(
      `Vendored Effect source not found at ${EFFECT_ROOT}.\n` +
        `Run \`pnpm run effect:vendor\` first — this index is built from source, not docs.`
    )
    process.exit(1)
  }
  const all = readdirSync(EFFECT_ROOT).filter((d) => statSync(join(EFFECT_ROOT, d)).isDirectory())
  if (scope === "all") return all
  if (scope === "core") return ["effect"]
  if (scope === "installed") return all.filter((p) => INSTALLED.includes(p))
  console.error(`Unknown --scope "${scope}". Use core | installed | all.`)
  process.exit(1)
}

// --- collect files ---
function walk(dir, out = []) {
  if (!existsSync(dir)) return out
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    const st = statSync(full)
    if (st.isDirectory()) walk(full, out)
    else if (entry.endsWith(".ts") && !entry.endsWith(".d.ts")) out.push(full)
  }
  return out
}

function collectFiles(packages) {
  const files = []
  for (const pkg of packages) {
    const kinds = testsOnly ? ["test"] : ["test", "src"]
    for (const kind of kinds) {
      for (const f of walk(join(EFFECT_ROOT, pkg, kind))) {
        files.push({ path: f, pkg, kind })
      }
    }
  }
  return files
}

/**
 * Split a TypeScript file on top-level boundaries that correspond to a unit a
 * reader would actually want: a test case, a describe block, or an exported
 * declaration. Anything at column 0 starting one of these forms begins a chunk.
 */
const BOUNDARY =
  /^(export (?:const|function|class|interface|type|namespace|declare)\b|(?:describe|it|test)(?:\.\w+)?\s*\(|\/\*\*)/

function symbolName(line) {
  const exp = line.match(/^export (?:const|function|class|interface|type|namespace|declare)\s+([A-Za-z0-9_$]+)/)
  if (exp) return exp[1]
  const spec = line.match(/^(?:describe|it|test)(?:\.\w+)?\s*\(\s*["'`](.+?)["'`]/)
  if (spec) return spec[1]
  return null
}

function chunkFile(file) {
  const text = readFileSync(file.path, "utf-8")
  const rel = relative(REPO_ROOT, file.path)
  const lines = text.split("\n")

  // Build boundary-delimited segments, each remembering its starting line.
  const segments = []
  let current = []
  let startLine = 1
  let label = null

  const flush = (endLine) => {
    const body = current.join("\n").trim()
    if (body.length >= MIN_CHUNK_CHARS) {
      segments.push({ body, startLine, label, endLine })
    }
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    if (BOUNDARY.test(line) && current.length > 0) {
      flush(i)
      current = []
      startLine = i + 1
      label = null
    }
    if (label === null) {
      const n = symbolName(line)
      if (n) label = n
    }
    current.push(line)
  }
  flush(lines.length)

  // Oversized segments get split on blank lines, preserving line offsets.
  const chunks = []
  for (const seg of segments) {
    if (seg.body.length <= MAX_CHUNK_CHARS) {
      chunks.push(makeChunk(file, rel, seg.body, seg.startLine, seg.label))
      continue
    }
    const segLines = seg.body.split("\n")
    let buf = []
    let bufStart = seg.startLine
    for (let i = 0; i < segLines.length; i++) {
      buf.push(segLines[i])
      if (buf.join("\n").length >= MAX_CHUNK_CHARS) {
        chunks.push(makeChunk(file, rel, buf.join("\n"), bufStart, seg.label))
        bufStart = seg.startLine + i + 1
        buf = []
      }
    }
    if (buf.join("\n").trim().length >= MIN_CHUNK_CHARS) {
      chunks.push(makeChunk(file, rel, buf.join("\n"), bufStart, seg.label))
    }
  }
  return chunks
}

function makeChunk(file, rel, body, line, label) {
  const breadcrumb = label ? `${rel}:${line} — ${label}` : `${rel}:${line}`
  return {
    text: body,
    breadcrumb,
    file: rel,
    line,
    pkg: file.pkg,
    kind: file.kind,
    // Prepending the location biases the embedding toward the module name,
    // which is what people actually query by ("Layer", "Schema transform").
    embedText: `${rel}\n\n${body}`
  }
}

// --- embeddings ---
async function embedBatch(texts) {
  const res = await fetch(VOYAGE_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${VOYAGE_API_KEY}`
    },
    body: JSON.stringify({ model: VOYAGE_MODEL, input: texts, input_type: "document" })
  })
  if (!res.ok) throw new Error(`Voyage API error ${res.status}: ${await res.text()}`)
  return (await res.json()).data.map((d) => d.embedding)
}

async function generateEmbeddings(chunks) {
  const BATCH_SIZE = 64
  const out = []
  const total = Math.ceil(chunks.length / BATCH_SIZE)
  for (let i = 0; i < chunks.length; i += BATCH_SIZE) {
    const batch = chunks.slice(i, i + BATCH_SIZE)
    console.log(`Embedding batch ${(i / BATCH_SIZE + 1) | 0}/${total} (${batch.length} chunks)...`)
    // Voyage rejects oversized inputs; the chunker bounds these already.
    out.push(...(await embedBatch(batch.map((c) => c.embedText))))
  }
  return out
}

// --- main ---
async function main() {
  const packages = resolvePackages()
  const files = collectFiles(packages)
  console.log(
    `Scope "${scope}"${testsOnly ? " (tests only)" : ""}: ${packages.length} package(s), ${files.length} files`
  )

  const chunks = files.flatMap(chunkFile)
  const byKind = chunks.reduce((a, c) => ({ ...a, [c.kind]: (a[c.kind] || 0) + 1 }), {})
  console.log(`Chunked into ${chunks.length} segments (${JSON.stringify(byKind)})`)
  console.log(`\nSample:`)
  for (const c of chunks.slice(0, 3)) console.log(`  ${c.breadcrumb} (${c.text.length} chars)`)

  if (dryRun) {
    const chars = chunks.reduce((a, c) => a + c.embedText.length, 0)
    console.log(`\n--dry-run: would embed ~${(chars / 4 / 1000) | 0}k tokens. No API calls made.`)
    return
  }

  if (!VOYAGE_API_KEY) {
    console.error("\nVOYAGE_API_KEY is required to embed. Use --dry-run to chunk without it.")
    process.exit(1)
  }

  const embeddings = await generateEmbeddings(chunks)

  const effectVersion = JSON.parse(readFileSync(join(EFFECT_ROOT, "effect", "package.json"), "utf-8")).version

  const index = {
    version: 2,
    model: VOYAGE_MODEL,
    created: new Date().toISOString(),
    source: "repos/effect (vendored source + tests)",
    effectVersion,
    scope,
    testsOnly,
    chunks: chunks.map((c, i) => ({
      id: i,
      breadcrumb: c.breadcrumb,
      file: c.file,
      line: c.line,
      pkg: c.pkg,
      kind: c.kind,
      text: c.text,
      // 5 decimals is well past cosine-ranking sensitivity and cuts the index
      // size roughly in half versus full float serialization.
      embedding: embeddings[i].map((n) => Math.round(n * 1e5) / 1e5)
    }))
  }

  mkdirSync(DATA_DIR, { recursive: true })
  const serialized = JSON.stringify(index)
  writeFileSync(INDEX_PATH, serialized)
  console.log(
    `\nWrote ${INDEX_PATH} (${(Buffer.byteLength(serialized) / 1024 / 1024).toFixed(1)} MB, ` +
      `${chunks.length} chunks, effect@${effectVersion})`
  )
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
