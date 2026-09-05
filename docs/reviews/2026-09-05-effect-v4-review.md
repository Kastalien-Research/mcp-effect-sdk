# SDK review and Effect v4 decision — 2026-09-05

Reviewed the clean `3ce71a2` baseline, current repository issues and release
evidence, the three requested Effect documents, and the installed RC source.
Historical documents are evidence of earlier work, not new task instructions.

## Current findings

| Finding                                                  | Evidence and disposition                                                                                                                                                                                                                                                                                                                                                                   |
| -------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Custom request methods remain unavailable                | `McpClient` and `McpServer.dispatch` route generated method groups. The official TypeScript SDK's custom-method story has no equivalent arbitrary-request API. This is an ergonomic extension gap, not a reason to restore legacy sessions.                                                                                                                                                |
| Tasks have schemas but no complete runtime               | [Issue 15](https://github.com/Kastalien-Research/mcp-effect-sdk/issues/15) remains actionable. Tasks are an opt-in extension, outside the migration and current core conformance claim.                                                                                                                                                                                                    |
| Some published diagnostics are stale                     | [Issue 13](https://github.com/Kastalien-Research/mcp-effect-sdk/issues/13) describes MRTR work now present; [issue 35](https://github.com/Kastalien-Research/mcp-effect-sdk/issues/35) describes example exclusions while all current examples compile. The historical example-parity report also predates working caching, JSON response selection, auth context, and prompt completions. |
| Tier 1 is not established by runtime tests               | The [August 31 Tier Audit](https://github.com/Kastalien-Research/mcp-effect-sdk/actions/runs/33373754073) passed conformance but failed the strict maintenance window at 1/9 timely first labels. Working Group designation remains external.                                                                                                                                              |
| Release roadmap lagged publication                       | [v1.0.0](https://github.com/Kastalien-Research/mcp-effect-sdk/releases/tag/v1.0.0) exists with a registry artifact and provenance. The roadmap's “not published” statement was stale. A new v4 release still needs its own evidence.                                                                                                                                                       |
| Baseline verification depended on local checkout hygiene | `.DS_Store` in vendored snapshots, ignored evaluation runs/external checkouts, and a non-writable npm cache caused six baseline gate failures. Source inventories now ignore filesystem metadata; lint and observability inventories exclude external/generated runs. Verification uses a writable local npm cache.                                                                        |

The baseline's official server, client, and client-auth harness checks passed.
That evidence predates the v4 edits and is not proof of the migrated candidate.

## Architecture decision

Target exact `effect@4.0.0-rc.112`, allow clean breaking API changes, and retain
the current protocol engine. The RC artifact's native MCP schemas support
through `2025-11-25`; native reverse-client support is not a full modern MCP
client. The August article is useful context, but package source determines
which protocol behavior can actually be reused.

The migration adopts v4 Schema, Context, fibers, queues, HTTP, and DevTools
directly. It does not introduce a v3 compatibility layer or expand scope into
Tasks, arbitrary-method routing, or the open legacy-profile proposal.

## Migration regressions addressed

- Internal request owners need reference equality: v4 structural hashing was
  traversing their live runtime callbacks and breaking terminal dispatch.
- Schema class encoding, canonical JSON input decoding, named schema references,
  recursive definitions, and captured codec services require explicit v4
  handling.
- Native JSON Schema filter fragments may be nested inside `allOf`. The actual
  Everything fixture now preserves root applicators, anchors, and optional
  header strings, with advertised-schema versus runtime agreement checked
  through AJV.
- HTTP runtime disposal must preserve request-body cleanup while closing owned
  response resources; queues distinguish graceful completion from interruption.
- V4 integer ranges include the upper bound by default. Cursor and cache IDs now
  explicitly use half-open byte ranges, tested at the maximum random value.
- Flat Causes preserve error values and interruption composition. Native pull
  handling avoids probing hostile transport errors as stream completion markers.
- Existing scheduling tests now wait for observable ownership and completion;
  `Queue.clear` replaces nonblocking v3 queue drains.

## Final validation

The final candidate passed `pnpm run verify` on Node **22.22.3** with pnpm
**10.11.1**. This includes lint, generated-source checks, Effect diagnostics,
type fixtures, unit/integration/end-to-end tests, packaging tests, and the
official conformance harness.

| Check                        | Result                                                                                                                                    |
| ---------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| Official server harness      | 114 passed; zero failures, warnings, or skips                                                                                             |
| Official client harness      | 436 passed; zero failures or warnings; two upstream checks skipped because the modern client does not send legacy initialization messages |
| Official client-auth harness | 247 passed; zero failures, warnings, or skips                                                                                             |
| Visual Effect application    | 231 tests passed; TypeScript, scoped Biome, and production build passed                                                                   |
| Packed artifact              | Contents verified against the build; all 11 export targets present                                                                        |
| Isolated packed consumer     | Strict peer installation passed; all 10 stable entrypoints import and resolve one shared Effect installation                              |

The verification log is `.local/effect-v4-migration/verify-final.log`. Final
conformance artifacts are under `.local/conformance/` in
`all-2026-09-05T18-21-19-340Z`, `client-all-2026-09-05T18-21-26-264Z`, and
`client-auth-2026-09-05T18-21-37-244Z`. Package checks are recorded in
`.local/effect-v4-migration/release-artifact-final.log` and
`packed-release-consumer.log`. These are local working-tree results; the tarball
is an unreleased candidate even though its version remains `1.0.0` until the
major changeset is applied. Application evidence is saved alongside these logs
in `app-tests.log` and `app-verification/mcp-ide.json`.

The readiness compiler reports repository health passing, while Tier 1 and
release claims remain blocked by missing candidate maintenance/release
provenance evidence. This migration does not publish, deploy, or claim official
Tier 1 recognition.
