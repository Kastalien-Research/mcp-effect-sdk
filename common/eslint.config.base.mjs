// @ts-check
import eslint from "@eslint/js"
import eslintConfigPrettier from "eslint-config-prettier/flat"
import nodePlugin from "eslint-plugin-n"
import { configs } from "typescript-eslint"

/**
 * Shared lint baseline, mirroring the layout of the official TypeScript SDK's
 * `common/eslint-config`. The rule set differs on purpose: this SDK is
 * Effect-native, so the correctness rules that matter most here — floating
 * Effects, missing context or error channels, Schema constructor overrides —
 * are enforced by `@effect/language-service`, not by ESLint. ESLint covers what
 * the Effect diagnostics do not, and `eslint-config-prettier` keeps it out of
 * formatting entirely.
 */
export default [
  eslint.configs.recommended,
  ...configs.recommended,
  {
    plugins: { n: nodePlugin },
    linterOptions: { reportUnusedDisableDirectives: true },
    rules: {
      // The Effect idiom uses leading-underscore names for tags and phantom
      // fields (`_tag`, `_A`), and deliberately unused type parameters.
      "@typescript-eslint/no-unused-vars": [
        "error",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_"
        }
      ],
      // `any` in an Effect signature silently erases the error and context
      // channels, which is exactly what `anyUnknownInErrorContext` catches at
      // the type level. Keep ESLint's version as a warning so the Effect
      // diagnostic stays the authority.
      "@typescript-eslint/no-explicit-any": "warn",
      "@typescript-eslint/consistent-type-imports": [
        "error",
        { prefer: "type-imports", fixStyle: "separate-type-imports" }
      ],
      "n/no-process-exit": "off",
      "no-console": "off"
    }
  },
  eslintConfigPrettier
]
