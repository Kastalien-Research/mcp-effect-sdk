# MCP Effect SDK Roadmap

`mcp-effect-sdk` is an Effect-native TypeScript SDK for the released MCP
`2026-07-28` specification.

## Current release objective

The immediate objective is a stable `1.0.0` release and an MCP SDK Tier 1
self-assessment. Tier designation remains subject to SDK Working Group review;
this roadmap does not claim approval or publication.

The finalization milestone requires:

- final dated MCP schema/spec source pins and deterministic generated output;
- 100% of applicable official server and client conformance checks;
- a same-commit server/client/client-auth composite evidence artifact;
- complete public API, test, documentation, and example mapping for every
  supported non-experimental feature;
- canonical maintenance, dependency, versioning, and security policies;
- a stable package tag, GitHub Release, and registry artifact; and
- a reproducible, self-assessed Tier-1-ready evidence bundle.

Submitting an upstream advancement request and receiving a formal SDK Working
Group designation are future community-governance steps outside this
finalization milestone.

## Architecture commitments

- Protocol-shaped public code is generated from exact, reviewed MCP sources.
- Handwritten code is limited to Effect runtime kernels, transports, auth
  integration, and documented ergonomic APIs.
- Public JSON boundaries decode through generated schemas.
- Stdio and Streamable HTTP are the supported core transports.
- Experimental extensions remain opt-in and outside core Tier qualification.
- The package does not restore the removed `2025-11-25` handshake, session, or
  server-initiated request model.

## Invariants

These rules are the source of truth for this package.

- The SDK is generated from MCP schema/spec artifacts wherever the schema can
  define the surface. `sources/vendor/mcp-core/schema.json` and `schema.ts` are
  the pinned protocol source of truth for the released `2026-07-28`
  specification.
- If a shape, method, request, notification, result, capability, content type,
  or method group exists in the MCP schema, generate it. Handwritten
  protocol-shaped code is a bug unless the generator cannot express it yet and
  the gap is documented.
- Public SDK APIs must not use `any`. Raw JSON boundaries may use `unknown`,
  then immediately decode through generated schemas. Effect error channels must
  use concrete error types, not `any`.
- Generated output must be deterministic, timestamp-free, and idempotent.
- Ad hoc repair scripts such as `fix-*.js`, `rewrite.js`, and `clean-fix.mjs`
  are not project tooling and should not be run or committed.

## Release tracking

| Milestone                   | Acceptance evidence                                                                                          | Status                                         |
| --------------------------- | ------------------------------------------------------------------------------------------------------------ | ---------------------------------------------- |
| Final source adoption       | Manifest uses released dated paths; regeneration and source checks pass                                      | In progress                                    |
| Protocol/runtime compliance | Direct server/client `--suite all` inventories pass with no failures or warnings                             | In progress                                    |
| Feature completeness        | [Machine-readable matrix](docs/conformance/feature-coverage.json) exactly covers the final supported surface | In progress                                    |
| Documentation               | Every matrix row has a public API, documentation anchor, runnable example, and test                          | In progress                                    |
| Operations                  | Canonical labels, rolling triage audit, P0 audit, and public policies pass                                   | Blocked: current 90-day triage is 1/9          |
| Stable release              | Tag, GitHub Release, registry artifact, integrity, changelog, and consumer test agree                        | Not published                                  |
| Tier 1 self-assessment      | Reproducible audit evidence satisfies the published Tier 1 policy                                            | Blocked by operations and publication evidence |

## Release-candidate record

The substantive `2026-07-28` release-candidate implementation landed before the
final specification release. The exact commits and the limits of that evidence
are recorded in
[release-candidate-history.md](docs/conformance/release-candidate-history.md).
Final-source adoption and stable publication are separate milestones.

## After `1.0.0`

- Track each MCP release candidate on a Working Group-agreed timeline.
- Run full conformance on every supported Node runtime and on the published
  artifact.
- Keep the feature matrix derived from the current final schema.
- Maintain the two-business-day triage and seven-day P0 resolution commitments.
- Treat Tasks and MCP Apps as independent experimental extension roadmaps unless
  they become required core features.

## Useful commands

```bash
pnpm run verify
pnpm run e2e:2026-07-28
pnpm run verify:conformance
pnpm run generate:docs-coverage
```
