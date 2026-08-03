import { spawn } from "node:child_process"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

export interface TestRunResult {
  passed: boolean
  output: string
}

const TIMEOUT_MS = 60_000

// pnpm exec resolves the `vitest` binary relative to cwd, so the spawn must
// run from this package's root (not the caller's cwd, and not `workdir`,
// which has no node_modules of its own) while `--root` points vitest at the
// exercise files to grade. Verified empirically against vitest@4.1.10.
const packageRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..")

// vitest@4.1.10's default reporter prints wall-clock/duration noise that
// differs on every run even when the outcome is identical: a "Start at
// HH:MM:SS" line, a "Duration Nms (transform Nms, ...)" line, and — critically,
// since this is the only output ever fed into a retry prompt (a failing run
// never breaks the attempt loop) — a trailing " Nms"/"Ns" suffix on every
// per-file and per-test summary line, e.g.:
//   ❯ tests/fail.test.ts (1 test | 1 failed) 4ms
//       × fails 3ms
// The brief's `/in \d+m?s/` pattern (kept below) does not match any of this —
// probed before writing this file — so each noisy shape is stripped
// explicitly. The per-line trailing-suffix strip is anchored to end-of-line
// (` <digits>m?s` immediately before the newline) rather than matching the
// substring anywhere, so it cannot clip through arbitrary test-name text the
// way an unanchored scrub could.
function scrub(output: string): string {
  return output
    .replace(/^[ \t]*Start at[ \t]+.*$/gm, "")
    .replace(/^[ \t]*Duration[ \t]+.*$/gm, "")
    .replace(/[ \t]+\d+(?:\.\d+)?m?s[ \t]*$/gm, "")
    .replace(/in \d+m?s/g, "")
}

export function runTests(workdir: string): Promise<TestRunResult> {
  return new Promise((resolve) => {
    let output = ""
    let settled = false

    const child = spawn("pnpm", ["exec", "vitest", "run", "--root", workdir], {
      cwd: packageRoot,
      env: process.env
    })

    const timer = setTimeout(() => {
      if (settled) return
      settled = true
      child.kill("SIGKILL")
      resolve({ passed: false, output: scrub(`${output}\n[testExec] timed out after ${TIMEOUT_MS}ms`) })
    }, TIMEOUT_MS)

    child.stdout?.on("data", (chunk: Buffer) => {
      output += chunk.toString()
    })
    child.stderr?.on("data", (chunk: Buffer) => {
      output += chunk.toString()
    })
    child.on("error", (err) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve({ passed: false, output: scrub(`${output}\n[testExec] spawn error: ${err.message}`) })
    })
    child.on("close", (code) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve({ passed: code === 0, output: scrub(output) })
    })
  })
}
