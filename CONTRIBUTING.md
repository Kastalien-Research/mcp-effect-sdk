# Contributing to the MCP Effect SDK

## Before you write code

Open an issue before starting new features or significant changes — new public
API, changes to the generated protocol surface, or anything that moves a
conformance or readiness claim. Straightforward bug fixes with a regression test
can skip this.

Two things in this repository are **not** hand-edited:

- `src/generated/**` is produced by `pnpm run generate:mcp` from the pinned
  schema in `sources/vendor/mcp-core/`. Change the generator, not the output;
  `check:generated` diffs it byte-for-byte.
- `sources/vendor/**` is hash-locked to `sources/manifest.json` and marked
  `-whitespace` in `.gitattributes`. Refresh it with `pnpm run sources:refresh`.

## Setup

```bash
corepack enable
pnpm install --frozen-lockfile
```

Node 22 or 24, pnpm 10.11.1 (pinned by `packageManager`).

## The commands you will actually use

| Goal                         | Command                                                 |
| ---------------------------- | ------------------------------------------------------- |
| Everything CI runs           | `pnpm run verify`                                       |
| Build SDK and examples       | `pnpm run build`                                        |
| Typecheck without emitting   | `pnpm run typecheck`                                    |
| Lint and format check        | `pnpm run lint`                                         |
| Fix lint and formatting      | `pnpm run lint:fix`                                     |
| Effect diagnostics as a gate | `pnpm run check:effect-lsp`                             |
| One focused area             | `pnpm run test:auth`, `test:transports`, `test:core`, … |

`pnpm test` is an alias for `pnpm run verify`.

Test aliases are named after what they cover (`test:wire`, `test:http`,
`test:input-required`), not after the work package that introduced them.
`test:core` and `test:auth` are the cumulative gates; each focused alias names
its test files directly and never delegates to another alias.

## Editor setup: the Effect language service

This is the single highest-leverage thing to set up. `@effect/language-service`
is configured in `common/tsconfig.base.json` and provides Effect-aware
diagnostics, refactors, and hovers that plain TypeScript cannot: floating
Effects, missing error or context channels, Schema constructor overrides, layer
composition graphs.

It only loads if your editor uses the **workspace** TypeScript, not its bundled
copy. In VS Code, `.vscode/settings.json` already prompts for this; accept it,
or run `TypeScript: Select TypeScript Version` → `Use Workspace Version`.

Because a TypeScript language-service plugin is loaded only by editors, `tsc`
never sees these diagnostics. `pnpm run check:effect-lsp` runs them in CI
instead, via `scripts/check-effect-lsp.mjs`.

### The Effect diagnostics baseline

Error-severity diagnostics fail the gate unless `effect-lsp-baseline.json` lists
them with a reason. The baseline is for debt you have decided to carry, not a
dumping ground:

- Entries match on **rule and file**, never line number.
- An entry whose diagnostic stops firing fails the gate too. Delete it; the
  baseline only records live debt.
- Every entry needs a `reason` explaining why the diagnostic does not apply, and
  a `revisitIf` describing what would change that.

Warnings and suggestions are printed but never fail. They are guidance.

## Style

Prettier and ESLint own formatting and lint. The settings deliberately differ
from the official TypeScript SDK's: this codebase is Effect-native, so it uses
the Effect ecosystem convention — two-space indent, no semicolons, double quotes
— rather than upstream's four-space, semicolon, single-quote style. Adopting
upstream's settings would rewrite roughly fifteen thousand lines against the
idiom the code is written in. The tooling is worth sharing; the settings are
not.

Do not reformat generated or vendored code. `.prettierignore` and
`eslint.config.mjs` already exclude it.

## Examples

`examples/` imports the SDK by package name (`mcp-effect-sdk/server`), never by
a relative path into `src/`. `test:examples` enforces this. If an example cannot
be written without reaching into `src/`, that is a missing export, not a reason
to reach past the boundary.

Two directories under `examples/` are quarantined and unbuilt; see
[`examples/README.md`](examples/README.md) before touching them.

## Changesets

Add one with `pnpm changeset` when a change is user-visible: public API, wire
behaviour, protocol coverage, or an observable bug fix. Docs, tests, check
scripts, and no-op refactors do not need one.

## Repository layout

| Path              | Contents                                                                               |
| ----------------- | -------------------------------------------------------------------------------------- |
| `src/`            | The SDK. Everything published.                                                         |
| `examples/`       | Runnable programs against the public export surface.                                   |
| `apps/`           | Applications that are not part of the package. See [`apps/README.md`](apps/README.md). |
| `test/`           | Node test suites, grouped by area, plus `test/types/` compile-only fixtures.           |
| `scripts/`        | Build, generation, conformance, and `check:*` gates.                                   |
| `common/`         | Shared TypeScript and ESLint bases.                                                    |
| `docs/`           | User-facing docs; `docs/internal/` for contributor and planning docs.                  |
| `sources/`        | Hash-locked upstream snapshots.                                                        |
| `typescript-sdk/` | Gitignored local clone of the official SDK, used as a parity oracle.                   |

`scratch/` is gitignored. Keep ad hoc repair scripts out of version control.
