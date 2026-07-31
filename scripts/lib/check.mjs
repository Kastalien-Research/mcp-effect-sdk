// The failure-accumulator idiom shared by every `check-*.mjs` gate.
//
// `requireText` / `requireJson` / `requireAll` were copy-pasted across
// check-extension-boundary, check-tier-operations, check-conformance-evidence,
// and check-sdk-workflow. `requireAll` in particular encodes a rule worth
// stating once: these gates assert what a document *commits to*, not how
// Prettier wrapped it, so prose is matched against a whitespace-collapsed
// projection. A gate that fails because a sentence re-wrapped is a false alarm.
import { existsSync, readFileSync } from "node:fs"
import path from "node:path"

export function createChecker({ root, name }) {
  const failures = []

  const resolve = (relativePath) => path.join(root, relativePath)

  const fail = (message) => {
    failures.push(message)
  }

  const requireText = (relativePath) => {
    const absolute = resolve(relativePath)
    if (!existsSync(absolute)) {
      fail(`Missing ${relativePath}`)
      return ""
    }
    return readFileSync(absolute, "utf8")
  }

  const requireJson = (relativePath) => {
    const source = requireText(relativePath)
    if (source === "") return undefined
    try {
      return JSON.parse(source)
    } catch (error) {
      fail(`${relativePath} is invalid JSON: ${error instanceof Error ? error.message : String(error)}`)
      return undefined
    }
  }

  // Needles may be written multi-line for readability; both sides are collapsed.
  const requireAll = (label, source, needles) => {
    const flattened = source.replace(/\s+/g, " ")
    for (const needle of needles) {
      if (!flattened.includes(String(needle).replace(/\s+/g, " "))) {
        fail(`${label} missing required text: ${needle}`)
      }
    }
  }

  const requireNone = (label, source, needles) => {
    const flattened = source.replace(/\s+/g, " ")
    for (const needle of needles) {
      if (flattened.includes(String(needle).replace(/\s+/g, " "))) {
        fail(`${label} must not contain: ${needle}`)
      }
    }
  }

  const exists = (relativePath) => existsSync(resolve(relativePath))

  /** Print accumulated failures and exit 1, or print the pass line and return. */
  const report = (passMessage) => {
    if (failures.length > 0) {
      throw new Error(`${name} failed:\n${failures.map((failure) => `- ${failure}`).join("\n")}`)
    }
    console.log(passMessage)
  }

  return { failures, fail, requireText, requireJson, requireAll, requireNone, exists, resolve, report }
}
