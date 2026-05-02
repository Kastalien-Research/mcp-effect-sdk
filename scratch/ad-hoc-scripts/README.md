# Ad Hoc Scripts Quarantine

These files were found at the package root as loose migration/debug scripts.
They are not supported project tooling and should not be run as part of normal
development.

They are kept temporarily as historical evidence while `mcp-effect-sdk/src/` is
reconciled with the older `mcp-effect-sdk/mcp/` tree.

Expected next outcomes for each file:

- delete it if it only records a failed compile-fix attempt
- replace it with a real package script if it captures a useful workflow
- document the decision in `ROADMAP.md` if any behavior must be preserved

Do not add new scripts here. New tooling belongs under `scripts/` and must be
referenced from `package.json`.
