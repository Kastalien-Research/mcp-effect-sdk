# Phase 7 Work Item: Extension Opt-In Gates

This is the Phase 7 grounding artifact for
`docs/acceptance-gates/sdk-generator.md`.

## Scope

Phase 7 keeps extension behavior separate from the core MCP SDK surface. The SDK
may expose an explicit extension capability configuration boundary, but it must
not advertise extensions by default, count extension behavior as core
conformance, or place experimental extension code in generated protocol files.

Out of scope:

- Implementing a concrete extension protocol.
- Adding extension-only conformance claims.
- Splitting this package into the TypeScript SDK's multi-package layout.

## Acceptance Criteria

| ID | Criterion | Required evidence |
| --- | --- | --- |
| AC-7.1 | Extension support is disabled by default. | Runtime helper returns no extension capabilities when no explicit extension config is provided. |
| AC-7.2 | Users opt in explicitly to each extension. | Server options use a named extension capability type; advertised extensions come only from that option. |
| AC-7.3 | Supported extensions are documented. | `docs/extensions.md` lists the current supported extension set. |
| AC-7.4 | Unsupported or malformed extension configuration receives clear rejection. | Runtime helper rejects malformed extension names before capabilities are advertised. |
| AC-7.5 | Extension support is not counted as core protocol conformance. | `docs/conformance/sdk-tier-evidence.md` states that extension behavior is excluded from core conformance evidence. |
| AC-7.6 | Experimental extension code is isolated from generated core protocol code. | A package-local checker fails if generated MCP files import extension policy code or if extension docs/policy are missing. |

## Expected Files

Expected new files:

- `docs/extensions.md`
- `scripts/check-extension-boundary.mjs`
- `docs/phase-7-extension-opt-in-gates.md`

Expected changed files:

- `src/McpServer.ts`
- `package.json`
- `scripts/verify.mjs`
- `docs/conformance/sdk-tier-evidence.md`
- `docs/acceptance-gates/sdk-generator.md`
- `ROADMAP.md`

## Dynamic Validation Commands

```bash
pnpm run check:extensions
pnpm run verify
pnpm run conformance:run
```

## Executable Acceptance Contract

`pnpm run check:extensions` must fail if:

- `docs/extensions.md` is missing.
- `docs/extensions.md` does not say no concrete extensions are currently
  supported.
- `src/McpServer.ts` lacks a named extension capability type.
- `McpServer` does not reject malformed extension capability keys.
- generated MCP files import from extension policy code.
- conformance tier evidence fails to exclude extension-only behavior.

Exit rule: do not add extension behavior to generated core protocol surfaces or
core conformance evidence.
