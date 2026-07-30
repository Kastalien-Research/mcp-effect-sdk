// @ts-check
import { defineConfig, globalIgnores } from "eslint/config"
import globals from "globals"

import base from "./common/eslint.config.base.mjs"

export default defineConfig(
  globalIgnores([
    "dist/",
    "coverage/",
    ".local/",
    // Read-only clone of the official SDK, kept as a parity oracle.
    "typescript-sdk/",
    // Read-only Effect upstream source, pinned for agent reference. Upstream
    // code under our lint rules is noise, not signal.
    "repos/",
    // Hash-locked to sources/manifest.json; see .gitattributes.
    "sources/vendor/",
    // Owned by `pnpm run generate:mcp` and diffed byte-for-byte by
    // `check:generated`.
    "src/generated/",
    // Quarantined, unbuilt. See examples/README.md.
    "examples/task-heavy/",
    "examples/typescript-sdk-ports/",
    // Excluded from tsconfig too: core tasks left the protocol in 2026-07-28
    // and this runtime is held for re-authoring as the tasks extension (#15).
    "src/McpTasks.ts",
    // Carries its own toolchain (Biome).
    "apps/visual-effect/",
    // Vendored clone of upstream Effect, installed by an external skills
    // manager as a pinned reference source. Not ours to lint.
    ".agents/**",
    // Workflow scripts run under an orchestrator that injects globals
    // (`agent`, `log`, etc.) ESLint has no way to see; not product code.
    ".claude/workflows/**"
  ]),
  ...base,
  {
    languageOptions: {
      globals: { ...globals.node }
    },
    rules: {
      // This is a protocol SDK: several validators exist precisely to reject
      // control characters in header values, tokens, and JSON-RPC frames, so a
      // control character in a regex here is the intent rather than a typo.
      "no-control-regex": "off"
    }
  },
  {
    // `F extends Fields = {}` is the Effect Schema idiom for "no fields by
    // default". The constraint carries the safety, so the `{}` default is not
    // the unconstrained-`{}` footgun the rule exists to catch — and the rule
    // has no option that distinguishes a constrained type-parameter default
    // from a bare annotation.
    files: ["src/**/*.ts"],
    rules: {
      "@typescript-eslint/no-empty-object-type": "off"
    }
  },
  {
    // Captures intrinsic getters and methods off `%TypedArray%.prototype` via
    // property descriptors so a caller cannot swap them. `Function` is the
    // honest type for an arbitrary descriptor value; narrowing it would mean
    // asserting a signature this module deliberately does not assume.
    files: ["src/internal/ExactUint8Array.ts"],
    rules: {
      "@typescript-eslint/no-unsafe-function-type": "off"
    }
  },
  {
    // Check scripts, suite runners, and the Node test suite: plain ESM
    // JavaScript, no TypeScript program.
    files: ["scripts/**/*.mjs", "test/**/*.mjs"],
    rules: {
      "@typescript-eslint/consistent-type-imports": "off"
    }
  },
  {
    // `test/types/**` are compile-only fixtures whose whole purpose is to
    // assert type-level facts. Empty interfaces are the assertion mechanism
    // (`interface _ extends Equals<A, B> {}`), and a declaration being unused
    // at runtime is the point — it only ever has to typecheck.
    files: ["test/types/**/*.ts"],
    rules: {
      "@typescript-eslint/no-empty-object-type": "off",
      "@typescript-eslint/no-unused-vars": "off",
      "@typescript-eslint/no-unused-expressions": "off",
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/consistent-type-imports": "off"
    }
  }
)
