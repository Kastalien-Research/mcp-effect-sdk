# Task 5H preflight: deprecated boundary, examples, and cumulative governance

## Frozen scope and dependency

- Base: accepted WP5G closeout
  `59ae86e3033fcc65abcb7280d2a6ddd5cb46a17f` (tree
  `ea39672f50805a7e0c12c15479d9a14b5d32cd40`).
- Implement only WP5H: finalize the minimal deprecated core boundary,
  re-author the active core examples against published entrypoints, make WP5
  focused/cumulative tests authoritative, and correct migration/readiness
  accounting for locally implemented WP5 behavior.
- Preserve every accepted WP2-WP5G behavior and the frozen generated MCP
  `2026-07-28` surface.
- Do not edit generated output, dependencies, the lockfile, transport kernels,
  authorization/DCR, Tasks, Apps, release metadata, remote issues/PRs, or Goal
  state. Do not publish, merge, release, close/reclassify issues, or claim
  official conformance, release readiness, or Tier status.

## Inventory and current drift

### Deprecated/public boundary

- `mcp-effect-sdk/deprecated` currently exports four values:
  `ElicitationHandler`, `RootsProvider`, `SamplingHandler`, and
  `sendLoggingMessage`.
- The WP5H contract permits only marked Roots, Sampling, and Logging hooks at
  this subpath. `ElicitationHandler` is obsolete because stable Elicitation is
  implemented by `InputRequiredPolicy` and `McpServer.requestInput`.
- `src/client-handlers/ElicitationHandler.ts`, the WP4 package/type fixtures,
  `scripts/check-sdk-runtime.mjs`, and `scripts/check-ts-sdk-parity.mjs` still
  encode the obsolete four-export contract.
- Roots and Sampling are generated MRTR input shapes but the retained
  `RootsProvider` and `SamplingHandler` service tags are compatibility-only.
  They must not advertise capabilities, install a standalone server-request
  dispatcher, or alter modern `InputRequiredPolicy` behavior.
- Logging remains a server notification helper. Invalid logging payloads keep
  the existing typed `SchemaValidationError` path; this task does not change
  notification routing or error mapping.
- DCR has no deprecated package export today. The plan summary assigns its
  deprecated fallback to the later authorization boundary, while the specific
  WP5H brief says to leave DCR to WP6. No DCR type, alias, example, or behavior
  will be added in WP5H.

### Active examples

- Four active source examples compile into `dist/examples/**`:
  `everything-server.ts`, `everything-client.ts`,
  `core-protocol-catalog.ts`, and `agent-facing-proof-servers.ts`.
- They currently import implementation modules such as `../McpClient.js`,
  `../McpServer.js`, `../McpSchema.js`, generated files, concrete transport
  files, and internal auth files. Those paths are not published subpaths.
- The examples already exercise discovery, tools, resources/templates,
  prompts, completion, progress/cancellation, and the scoped Subscription.
  The catalog does not yet demonstrate stable Elicitation through the
  input-required policy.
- `everything-client.ts` remains the separate client-auth conformance target.
  WP5H may route its existing auth imports through the currently published root
  OAuth namespaces, but may not change auth behavior or introduce the future
  WP6 auth subpaths early.
- `src/examples/task-heavy/**` and `src/McpTasks.ts` remain excluded. WP5H will
  not re-author them because Tasks is WP7.

### Test and readiness governance

- Individual WP5A-WP5G scripts exist, but naming and cumulative ownership are
  inconsistent. `verify` currently runs cumulative `test:wp5e`; it therefore
  does not execute the accepted WP5F or WP5G suites.
- There is no authoritative `test:wp5-core`, no WP5H focused command, and no
  final consolidated public-type/packed-consumer fixture.
- Existing WP4/WP5B packed tests prove part of the package boundary, but the
  WP5 final gate must additionally prove the complete modern client/server/
  protocol/transport/deprecated surface and the final three-export deprecated
  boundary from a tarball consumer.
- The GitHub workflow already has Node 22 and 24 lanes with frozen strict-peer
  installation. Local Node `v22.22.3` and `v24.15.0` are available for exact
  CI-equivalent candidate reruns.
- `docs/conformance/ts-sdk-parity-deferred.json` and its checker still mark
  WP5 as deferred. Migration/scenario/Tier docs still describe MRTR,
  Subscriptions, and re-authored examples as implementation follow-ups even
  though WP5A-WP5G have locally accepted evidence. Higher readiness claims and
  official conformance remain blocked.

## Exact public and removal boundary

1. `mcp-effect-sdk/deprecated` will expose exactly:
   `RootsProvider`, `SamplingHandler`, and `sendLoggingMessage`.
2. All three retained values and their source declarations remain explicitly
   annotated `@deprecated`. Their comments will point callers to modern MRTR
   policy where applicable and will state that they do not restore standalone
   server requests.
3. `ElicitationHandler` will be removed from the deprecated entrypoint and its
   unused source file will be deleted. There is no compatibility alias and no
   deep import is published.
4. Stable Elicitation remains available only through
   `mcp-effect-sdk/client`'s `InputRequiredPolicy`/Elicitation handler types and
   `mcp-effect-sdk/server`'s `requestInput`. Form handling is explicit; URL
   handling remains deny-by-default unless an explicit policy handler exists.
5. No deprecated hook is added to the root, `./client`, `./server`, or
   revisioned protocol subpath. Generated Roots/Sampling/Elicitation wire
   shapes remain in the revisioned protocol because MRTR uses them.
6. DCR remains untouched for WP6. Existing root OAuth exports are not
   redesigned in this package.

Removal failure policy:

- A source consumer importing `ElicitationHandler` from the deprecated subpath
  receives a compile-time missing-export error.
- A runtime consumer observes no such export. Deep package paths remain sealed
  by `exports` and fail package resolution.
- There is no runtime forwarding, warning alias, capability mutation, or
  server-request compatibility path.
- Existing stable Elicitation failures remain typed by the accepted WP5F
  contract (`McpClientError`/`InputRequiredError` and exact server MCP errors);
  WP5H does not remap them.

## Published-entrypoint example contract

- Active source examples may import Effect/Node dependencies and only these
  SDK entrypoint sources, each of which is the source owner for a published
  package export:
  `../index.js`, `../client.js`, `../server.js`,
  `../protocol/2026-07-28.js`, `../transport/http.js`,
  `../transport/stdio.js`, and `../deprecated.js`.
- Examples may not import `../Mcp*.js`, `../generated/**`, `../internal/**`,
  `../auth/**`, or concrete transport implementation files.
- `McpSchema`, `McpProtocol`, and `McpErrors` will be consumed through the
  revisioned protocol entrypoint. Client and server conveniences will be
  consumed through `./client` and `./server`; transports through their public
  subpaths.
- Existing client-auth fixture behavior will use the currently published root
  `OAuth` and `OAuthProviders` namespaces only. This is routing through an
  existing public export, not WP6 auth implementation or endorsement of a
  final WP6 API.
- The catalog will include a small compiling stable form-Elicitation/MRTR
  example using `McpServer.requestInput` and
  `McpClient.InputRequiredPolicy.automatic`. It will state that URL
  Elicitation requires an explicit handler and that the SDK never navigates or
  fetches it automatically.
- The catalog's scoped Subscription example will remain scoped and consume
  the returned product. Deprecated logging may continue only through the
  published deprecated subpath, because Logging is intentionally retained
  there.
- A source-import allowlist test plus a packed consumer will prove that the
  examples do not depend on unpublished deep paths. WP10 still owns complete
  release-quality narrative documentation and examples for later auth/Tasks/
  Apps surfaces.

## Focused and cumulative command contract

Retain existing granular commands for compatibility and add these authoritative
WP5 aliases:

- `test:wp5-results` — WP5A runtime and public types.
- `test:wp5-construction` — WP5B client/server/subpath runtime and types.
- `test:wp5-json-schema` — WP5C validator/tool-output runtime and types.
- `test:wp5-pagination-cache` — WP5D pagination/cache/HTTP catalog and types.
- `test:wp5-progress-cancellation` — WP5E server/client runtime and types.
- `test:wp5-input-required` — WP5F client/server/state runtime and types.
- `test:wp5-subscriptions` — WP5G runtime, public types, and package checks.
- `test:wp5-deprecated` — exact deprecated runtime/source/type boundary.
- `test:wp5-examples` — build, public-entrypoint import allowlist, and active
  example load/contract checks.
- `test:wp5-package` — consolidated public type fixture and packed runtime/type
  consumer.
- `test:wp5-core` — cumulative chain of every focused alias above.

`scripts/verify.mjs` will replace its stale `test:wp5e` ownership with exactly
`test:wp5-core`. The exact full `pnpm run verify` remains package health only;
client-auth/official conformance stays separate.

The consolidated public type fixture will import only real package specifiers
and prove:

- modern client/server/protocol/stdio/http APIs are usable;
- accepted WP5 result, JSON Schema, pagination/cache, progress, MRTR,
  continuation-state, and Subscription types remain reachable only through
  intended stable entrypoints;
- Roots/Sampling/Logging are available only from `./deprecated`;
- `ElicitationHandler` is absent from `./deprecated`, while stable
  `ElicitationInputHandlers` remains under `./client`;
- no DOM type enters root/Node graphs (retaining the accepted WP5B graph gate).

The packed fixture will create an isolated tarball consumer, link only declared
runtime/peer dependencies, import every current stable WP5 package subpath,
verify exact deprecated runtime keys and sealed deep paths, and compile a
strict Node 22 type consumer. The same `test:wp5-core`/`verify` command under
Node 24 supplies the second-runtime packed proof; no machine-specific Node path
will be committed.

## Readiness and documentation accounting

- Change the WP5 deferred-ledger entry from `deferred` to an explicit local
  implementation state with accepted task evidence/verification ownership;
  keep WP6-WP11 deferred. Update the checker so it fails if WP5 is again
  treated as deferred or if a later work package is promoted early.
- Update the migration guide to move the subscription product and stable MRTR
  from follow-up language into implemented core behavior, describe the final
  deprecated boundary, and identify the cumulative WP5 command.
- Update the scenario map and Tier evidence so #13/#14/#19 are not described as
  missing local implementation. They may be recorded as locally implemented
  WP5 work whose external issue disposition still requires approval. Do not
  close, reclassify, or imply closure of any remote issue.
- Preserve the explicit blockers: official draft conformance, WP6 auth/client-
  auth, Tasks, Apps, release provenance/publication, maintenance history,
  agent evidence, final-spec reconciliation, and Working Group designation.
- Keep `Tier 3` as the current evidenced tier and keep `MCP Tier 1`,
  `artifact-goal done`, and `release-ready` blocked. A green checker means only
  truthful internal accounting.
- Update parity/conformance/runtime guard scripts that currently require
  `ElicitationHandler` or deep example imports. Do not weaken unrelated
  modern-surface, protocol-version, generated, or conformance assertions.

## Meaningful committed RED witnesses

Before editing production/example/governance sources, add and commit:

1. `test/packaging/wp5h-deprecated-boundary.test.mjs`:
   - exact three runtime exports;
   - every retained hook marked deprecated;
   - no `ElicitationHandler` source/export;
   - no deprecated root/client/server leakage;
   - stable Elicitation policy/server APIs remain present;
   - retained Roots/Sampling tags cannot create a server-request path.
2. `test/packaging/wp5h-examples.test.mjs`:
   - every active example import is on the public-entrypoint allowlist;
   - all active compiled examples load;
   - catalog exports the stable Elicitation policy/request example and scoped
     Subscription example;
   - task-heavy sources remain excluded.
3. `test/packaging/wp5h-governance.test.mjs`:
   - every named focused command and `test:wp5-core` exists;
   - `verify` owns `test:wp5-core` and not the stale `test:wp5e` aggregate;
   - WP5 is locally implemented in the accounting ledger while WP6-WP11 stay
     deferred;
   - docs preserve Tier/readiness blockers and no overclaim.
4. `test/types/wp5-core-public/**`:
   - complete positive stable API fixture;
   - `@ts-expect-error` proof that deprecated Elicitation is absent;
   - positive stable Elicitation policy type proof.
5. `test/packaging/wp5h-packed-core-consumer.test.mjs`:
   - packed runtime imports/exact keys/deep-path sealing;
   - strict public package-specifier type consumer.

Expected initial RED at accepted base:

- deprecated runtime/source assertions fail because `ElicitationHandler` is
  still present;
- the type fixture fails with an unused missing-export expectation because the
  obsolete export still resolves;
- every active example fails the deep-import allowlist;
- catalog stable-Elicitation example assertions fail because it is absent;
- command/verify assertions fail because the aliases and cumulative gate are
  absent and `verify` stops at WP5E;
- ledger assertions fail because WP5 remains `deferred`;
- the packed exact-key assertion fails because the tarball still exports four
  deprecated values.

The direct RED command, before package aliases exist, will be:

```bash
pnpm run build
node --test \
  test/packaging/wp5h-deprecated-boundary.test.mjs \
  test/packaging/wp5h-examples.test.mjs \
  test/packaging/wp5h-governance.test.mjs \
  test/packaging/wp5h-packed-core-consumer.test.mjs
pnpm exec tsc -p test/types/wp5-core-public/tsconfig.json --noEmit
```

Record exact test counts and individual intended failures. Existing accepted
WP5 suites must remain green in the RED commit; the new failures must be
specific to the missing WP5H contract.

## Candidate atomic commits after approval

1. `test: define WP5H public and governance contract` — tests/type/packed
   fixtures only; record meaningful RED.
2. `refactor: finalize deprecated core boundary` — remove obsolete
   Elicitation service export/source and update exact boundary guards.
3. `docs/examples: use published modern core entrypoints` — re-route active
   examples, add the bounded stable Elicitation example, and update migration/
   scenario/Tier/deferred accounting without readiness overclaims.
4. `build: make cumulative WP5 verification authoritative` — add focused
   aliases, `test:wp5-core`, packed/public fixtures, and the `verify` hook.
5. `docs: record WP5H candidate evidence` — append exact commands/results to
   `.superpowers/sdd/task-5-report.md` and freeze the immutable review package.

If an implementation dependency forces overlap, keep each commit coherent and
preserve the committed RED-before-production order.

## Candidate verification and compatibility gates

All counted Node 22 commands use `/Users/b.c.nims/.nvm/versions/node/v22.22.3`
and pnpm `10.11.1` through Corepack; Node 24 uses the available `v24.15.0`
runtime with the same pinned pnpm and frozen lockfile.

Node 22 focused/final:

```bash
CI=true pnpm install --frozen-lockfile --strict-peer-dependencies
CI=true pnpm run test:wp5-deprecated
CI=true pnpm run test:wp5-examples
CI=true pnpm run test:wp5-package
CI=true pnpm run test:wp5-core
CI=true pnpm run test:wp4-wire
CI=true pnpm run test:wp4-dispatcher
CI=true pnpm run test:wp4-stdio
CI=true pnpm run test:wp4-http
CI=true pnpm run test:wp4-transports
CI=true pnpm run test:wp3-schema
CI=true pnpm run test:wp3-protocol
CI=true pnpm run test:wp2-review
CI=true pnpm run verify
```

Node 24 CI-equivalent final:

```bash
CI=true pnpm install --frozen-lockfile --strict-peer-dependencies
CI=true pnpm run test:wp5-core
CI=true pnpm run verify
```

Also require `git diff --check`, unchanged `pnpm-lock.yaml`, immutable package
hash verification, and a clean tracked tree. HTTP/full verify loopback runs use
the already approved network permission if the restricted sandbox returns only
`EPERM`; a restricted failure is not counted as green.

Compatibility gates retained by `test:wp5-core` and full verify include all
accepted WP5A-G focused runtime/types/package suites, WP4 wire 18/18,
dispatcher 31/31, stdio 22/22, HTTP 116/116, transports 12/12, WP3 schema
28/28 and protocol 14/14, WP2 17/17, source/hash/generated/invariant/schema/
type checks, build, unit, integration, both draft E2E scenarios, and readiness
accounting. Standalone alpha.9 client-auth remains separate until WP6.

## Risks and resolved ambiguities

- **Plan-level DCR wording versus the WP5H brief:** the more specific sequence
  wins. DCR is an auth fallback and remains WP6; WP5H adds nothing.
- **Auth imports in `everything-client`:** only import routing changes, through
  existing public root namespaces. Any auth behavior/API redesign waits for
  WP6 and its independent RED/review gate.
- **Deleting `ElicitationHandler`:** it is unreferenced production code outside
  the deprecated entrypoint and stale guards. Stable Elicitation remains
  separately implemented and will receive positive type/example proof.
- **Deprecated Roots/Sampling semantics:** retaining a service tag must not be
  documented as active routing. The modern functional path is
  `InputRequiredPolicy`; deprecated tags are migration symbols only.
- **Examples versus WP10 docs:** WP5H makes core examples public-API-correct
  and adds the missing bounded stable Elicitation example. WP10 still owns
  comprehensive release-quality docs and all later-surface examples.
- **Readiness versus implementation:** locally accepted feature evidence may
  remove a work item from the deferred ledger, but it cannot satisfy official
  conformance, release, maintenance, publication, final-spec, or Tier gates.
- **Packed consumer isolation:** symlink only declared dependencies, never a
  sibling checkout. Node 22/24 reruns prove the same tarball contract against
  both supported runtime families.
