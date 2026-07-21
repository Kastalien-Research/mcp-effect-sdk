# Work Package 5 evidence report

## Scope and dependency

- Branch: `codex/wp5-core-features`
- Worktree: `/private/tmp/mcp-effect-sdk-wp5`
- Accepted dependency: WP4 acceptance head
  `2497f2dae9678d19d76bb6ad040639fa70f48473`
- WP5 remains stacked on draft PR #31 and must not merge autonomously.
- Generated MCP `2026-07-28` codecs remain normative.
- This report records bounded WP5 acceptance evidence without claiming official
  conformance, release readiness, or Tier status.

## Task 5A: strict result envelopes and server identity

Status: accepted at `b6dc2364321113e3f502a5a7aa157381bd159c63`
after independent immutable rereview returned `APPROVE` with 0 Critical,
0 Important, and 0 Minor findings.

### Delivered behavior

- Every high-level successful server result is sanitized and exact-encoded
  through its generated method codec before configured server identity is
  injected at `_meta.io.modelcontextprotocol/serverInfo`.
- Handler top-level `serverInfo` and reserved metadata identity are discarded
  before their descriptors are requested. Non-reserved metadata and open
  result fields are preserved only when canonical JSON.
- `serverInfoFromResult` returns `Option<Implementation>` from the reserved own
  metadata data property and never trusts top-level identity.
- Every high-level client result uses the exact generated method result codec.
  Encoded, decoded, and legitimate mixed generated representations converge
  through an exact encode, strict JSON snapshot, and exact decode.
- Complete and `InputRequiredResult` unions remain method-limited. Invalid
  cache/discriminator/result shapes and non-JSON open values fail as typed
  protocol errors without masking transport Causes.
- Decoded blob/image/audio bytes remain supported through one shared internal
  exact-byte snapshot. Only intrinsically branded, exact-prototype,
  fixed, non-shared, non-detached `Uint8Array` views are copied. Subclasses,
  prototype-mutated other typed arrays, extra keys, accessors, invalid
  descriptors, Proxies, detached views, resizable buffers, and shared buffers
  fail closed at both client and server boundaries.
- Strict wire JSON behavior is unchanged and no public API, generated output,
  dependency, or WP5B+ surface was added by the review fixes.

### Exact commits

The complete accepted Task 5A range is `2497f2d..b6dc236` (19 commits):

1. `957f0c508c0c939124d5ea83fa62a93c44b20d7b` — define strict result envelope RED contract.
2. `a63ba496f9c98e9cb8420b07f61b9fe8fd850e37` — attach server identity to result metadata.
3. `ca5403fe26807d791c22bbb2d4d78e06f4d46f16` — decode client results by generated method codec.
4. `69efe7242f10cf2fdfd30af9a844eb748838a1a5` — align runtime probe with strict results.
5. `a5aaeb7f5877a593257116237ac258c600b731f1` — hostile result-boundary RED witnesses.
6. `782e3b3e421660963486f5466a756754df25342c` — sanitize server results before encoding.
7. `9ecaffdb1f6eeb197e02d88e2ae54acc97f06fbd` — normalize client results before decoding.
8. `28cc8be064eb1c8e65ff1ffeffb6a43e1870f54f` — preserve binary schema inputs.
9. `e5ec046dfcfe5cd084fea268de45590697c05326` — accept decoded schema result data.
10. `6ff66a23698b49ad7a431bf5e787b94d7c613b14` — reserved descriptor-trap RED witnesses.
11. `3dfe425c7f37e1c0ea957705be107324984d501e` — skip reserved descriptors before inspection.
12. `7c5e0f28786ea71ea68c551d4e44faaa819235f4` — decoded binary client RED witnesses.
13. `a4068f9cc28a6a233d89a008ada119217c03d1cc` — accept decoded binary client results.
14. `5b41eeb1d4e638913f7362f0255185abadbc8ab5` — canonical binary-boundary RED witnesses.
15. `82c65abd421367c64a7f456b78292d8aa309d155` — canonicalize decoded binary results.
16. `04d88c0fe6173178ad3b97d07650fad030b49437` — mixed decoded discovery RED witness.
17. `c31e1f57ad0d853307fceb79e76d655f3a17b07d` — canonicalize mixed decoded results.
18. `eafb37844880d15fa36262f613cbcb31c8a66863` — unstable binary-view RED witnesses.
19. `b6dc2364321113e3f502a5a7aa157381bd159c63` — snapshot only stable exact Uint8Array views.

### Review history and resolution

1. First immutable review at `69efe72`: `CHANGES REQUIRED`, 0 Critical,
   2 Important, 1 Minor. Server handler results needed pre-encoding sanitation;
   client decoding needed total descriptor-safe hostile-value handling; obsolete
   comments needed correction. Resolved by committed RED `a5aaeb7` and GREEN
   `782e3b3..e5ec046`.
2. Rereview at `e5ec046`: `CHANGES REQUIRED`, 0 Critical, 1 Important,
   0 Minor. Reserved descriptors were requested before reserved keys were
   discarded. Resolved by RED `6ff66a2` and GREEN `3dfe425`.
3. Rereview at `3dfe425`: `CHANGES REQUIRED`, 0 Critical, 1 Important,
   0 Minor. Valid decoded generated binary result classes were rejected.
   Resolved by RED `7c5e0f2` and GREEN `a4068f9`.
4. Rereview at `a4068f9`: `CHANGES REQUIRED`, 0 Critical, 2 Important,
   0 Minor. Non-JSON runtime values survived open decoded positions and a
   cooperative non-view Proxy could spoof the byte path. Resolved by RED
   `5b41eeb` and GREEN `82c65ab`; full E2E then exposed a legitimate mixed
   discovery representation, resolved by RED `04d88c0` and GREEN `c31e1f5`.
5. Rereview at `c31e1f5`: `CHANGES REQUIRED`, 0 Critical, 2 Important,
   0 Minor. Prototype-mutated other typed-array brands were reinterpreted and
   detached/resizable backing stores were accepted; shared backing policy was
   unresolved. Resolved by RED `eafb378` and GREEN `b6dc236` with a shared
   intrinsic brand/storage/snapshot helper and fail-closed shared policy.
6. Final independent immutable rereview of `2497f2d..b6dc236`, special range
   `c31e1f5..b6dc236`: specification compliance PASS, code quality PASS,
   0 Critical, 0 Important, 0 Minor, verdict `APPROVE`.

Final immutable identity:

- Candidate tree: `f1b06adfe5545e648db4f17708a8b3ea53c5ecbf`
- Full binary diff SHA-256: `21a9d8930490f39103f8ecaf7a3bc63d693844b06cde4be7d2a4c9e8138f4be3`
- Final fix diff SHA-256: `d991e585ef7180dbba6b70ca21c2bd19ca9631a2cafce67a040742548de83420`
- Review package: `.superpowers/sdd/task-5a-intrinsic-rereview-package.md`

### TDD evidence for final fix

Node `v22.22.3`, Corepack/pnpm `10.11.1`:

- Committed RED `eafb378`: `pnpm run test:wp5a` exited 1 with 66 tests,
  52 pass and 14 intended failures. The 12 new client/server witnesses plus
  their two parent tests failed; genuine fixed bytes and every prior case
  remained green.
- GREEN `b6dc236`: `pnpm run test:wp5a` passed 66/66 plus the public type
  fixture.

Earlier RED/GREEN counts and exact candidates are retained in the immutable
review packages and ignored recovery ledger.

### Accepted-candidate verification

All counted commands used Node `v22.22.3` and pnpm `10.11.1` through Corepack.

- `CI=true pnpm run test:wp5a`: 66/66 plus public type fixture, exit 0.
- `CI=true pnpm run test:wp4-wire`: 18/18 plus public type fixture, exit 0.
- `CI=true pnpm run test:wp2-review`: 17/17, exit 0.
- `CI=true pnpm run test:wp3-schema`: 28/28, exit 0.
- `CI=true pnpm run test:wp3-protocol`: 14/14, exit 0.
- `CI=true pnpm run check:sdk-runtime`: pass.
- First restricted-sandbox `CI=true pnpm run verify`: exit 1 only because
  loopback binds returned `EPERM`; it was not counted as green.
- Exact rerun with approved loopback access, `CI=true pnpm run verify`: exit 0.
  HTTP passed 116/116; `draft-round-trip` and `tools-call` passed twice;
  `GR-TEST-004` passed; readiness accounting was internally consistent.
- `git diff --check 2497f2d..b6dc236`: pass.
- Tracked worktree was clean at the reviewed candidate.

### Remaining risks and truth boundaries

- Exact-prototype policy intentionally rejects cross-realm Uint8Arrays.
- Supported Node 22/24 runtimes provide the required resizable-buffer
  intrinsic; an environment without it fails closed.
- Defensive copies scale with valid byte payload size; surrounding request and
  transport size limits remain responsible for bounding input.
- Final rereview inspected the recorded dynamic evidence but did not rerun it;
  the implementer-owned exact commands above are the dynamic proof.
- WP5B-WP5H remain incomplete. Official conformance, authorization, Tasks,
  Apps, release, final-spec reconciliation, publication, and Tier designation
  remain separate later gates.

## Task 5B: modern constructors and stable core subpaths

Status: accepted at `051f4c53abce2bb95bd4e4743efcb3d3ceb08af2`
after final independent immutable rereview returned `APPROVE` with 0 Critical,
0 Important, and 0 Minor findings.

### Delivered behavior

- Object-form client construction with optional exact identity, captured
  provider environments, fresh method/ID-aware request profiles, exclusive
  extension authority, descriptor-owned canonical snapshots, exact generated
  extension-name/JSONObject validation, and typed Cause-preserving provider
  failure normalization. Valid empty member names such as `com.example/` are
  retained; malformed labels/member boundaries fail before transport.
- Explicit server `make`/`layer` with one registration Effect, typed
  pre-handler validation, isolated state, and request-local client metadata.
  Stdio, HTTP, and Effect Platform require explicit server construction; the
  raw Web handler accepts a constructed service only after registration
  requirements are discharged.
- Exact stable `./client`, `./server`, and `./protocol/2026-07-28` exports,
  intentional root routing, literal revision allowlist, packed runtime/type
  proof, sealed deep paths, DOM-free declarations, and Node-built-in-free new
  core subpath graphs. Complete Node built-ins and all supported dependency
  edge forms are checked through TypeScript AST analysis. All three real
  declarations are compiler-enumerated against complete value-plus-type
  allowlists, with adversarial type/interface/export-star mutation proof.
- Cumulative WP5B is part of `verify`; no dependency, generated output,
  WP5C+, auth, Tasks, Apps, remote, release, or Tier behavior changed.

### Exact commits

The accepted range `83f6ad9..051f4c5` contains 17 commits:

1. `d8ac874` — client-construction RED.
2. `cebf9d5` — request-profiled object client construction.
3. `2048392` — explicit server-construction RED.
4. `7348fb2` — isolated explicit server construction.
5. `82061f8` — stable core-subpath RED.
6. `7c03898` — exact stable core subpaths.
7. `120ef5e` — parity guard migration to object construction.
8. `4144967` — truthful pending-review evidence.
9. `292fa92` — constructor-ownership/extension/HTTP-boundary RED.
10. `6ca2c67` — hardened construction boundaries.
11. `6b611de` — package-parser bypass RED.
12. `a89b0f5` — TypeScript-AST package analysis.
13. `67bdebc` — empty extension member-name RED.
14. `c47adc0` — exact empty member-name support.
15. `38a0f1d` — real declaration-snapshot bypass RED.
16. `04751d7` — compiler-backed real declaration export snapshots.
17. `051f4c5` — repository extension invariant aligned with generated grammar.

### Review history and resolution

1. First independent review at `4144967`: `CHANGES REQUIRED`, 0 Critical,
   4 Important, 0 Minor. It found live constructor option rereads, incomplete
   concurrent-provider proof, extension grammar/JSONObject drift, an unsound
   HTTP Layer requirement cast, and regex/parser package-boundary bypasses.
   Resolved by committed RED `292fa92`/`6b611de` and GREEN
   `6ca2c67`/`a89b0f5`.
2. Second independent review at `a89b0f5`: `CHANGES REQUIRED`, 0 Critical,
   2 Important, 0 Minor. It found the valid empty extension member name was
   rejected and compiler export enumeration was not applied to the real
   emitted declarations. Resolved by RED `67bdebc`/`38a0f1d` and GREEN
   `c47adc0`/`04751d7`. Full verify then exposed one stale extension check,
   corrected at `051f4c5` without weakening malformed-name/settings negatives.
3. Final fresh independent rereview of `83f6ad9..051f4c5`, special range
   `a89b0f5..051f4c5`: specification compliance PASS, code quality/security
   PASS, 0 Critical, 0 Important, 0 Minor, verdict `APPROVE`.

Final immutable identity:

- Candidate tree: `ce57e0f03c46712f86a9d16a9c14de465579d62f`
- Full binary diff SHA-256:
  `ce6c9cbaa8ccbca2fa249c29e94be6443b80f1127ca60bb0717062ee3cd428ab`
- Final-fix binary diff SHA-256:
  `020237b9cab3339778dfb3a5c7c0fcdbb8defd8d3d2b02409fa5fe501d9d3f34`
- Final review package:
  `.superpowers/sdd/task-5b-final-rereview-package.md`

### Accepted-candidate verification

Node `v22.22.3`, Corepack/pnpm `10.11.1`:

- `pnpm run test:wp5b`: exit 0; WP5A 66/66, client 32/32, server
  25/25, subpaths 11/11, and all public type fixtures passed.
- Exact loopback-enabled `CI=true pnpm run verify`: exit 0. WP2-WP4,
  HTTP 116/116, package/type/generated/unit/integration gates, extension
  boundary, and both draft E2E scenarios twice passed; readiness accounting
  was internally consistent.
- Final reviewer independently reran `pnpm run test:wp5b` and
  `pnpm run check:extensions`, both exit 0.
- `git diff --check 83f6ad9..051f4c5`: pass; tracked status clean at the
  reviewed candidate.

Official draft-targeted conformance, release provenance/stable release,
documentation publication, agent evidence, and Tier claims remain truthfully
blocked and out of scope for WP5B.

## Task 5C: JSON Schema 2020-12 validation and bounded resolution

Status: accepted at `f6af08e605cea4bdd0647fca35d3ab2851ca4b1f`
after final independent immutable rereview returned `APPROVE`: specification
compliance PASS, code quality APPROVED, 0 Critical, 0 Important, 0 Minor.

### Delivered behavior

- Effect-native, platform-free `JsonSchemaValidator` and opt-in
  `JsonSchemaResolver` services are exported only through the stable server
  boundary. Ajv `8.20.0` is an exact runtime dependency; Ajv types do not cross
  the public API and `ajv-formats` remains development-only.
- JSON Schema 2020-12 is explicit. Arbitrary strict JSON, local/dynamic refs,
  composition, schema-valued compatibility `dependencies`/`definitions`, and
  non-mutating validation are covered. Legacy recursive keywords rejected by
  Ajv 2020 are rejected before external resolution.
- External resolution is disabled by default and, when supplied, enforces
  scheme/host allowlists, exact depth/byte/redirect/total-timeout budgets,
  canonical retrieval/`$id` aliases, cycle deduplication, and descriptor-safe
  snapshots. String-array dependencies and unknown annotations are not
  traversed.
- Tool output schemas compile before registration and validate
  `structuredContent` before success framing or metadata. Missing/invalid
  structured output becomes a safe typed `-32602`; diagnostics, arbitrary
  callback data, schemas, values, and sensitive external URIs remain local.
- Effect-generated tool input schemas describe the encoded side, explicitly
  select 2020-12 tuple semantics, agree with runtime excess-property rejection,
  and convert unsupported generation into local `SchemaValidationError`.
- Compiler, resolver, and compiled-validator callbacks are owned once, require
  Effects, contain synchronous throws/defects, preserve full Cause composition
  and interruption, and never invoke hostile accessors. Typed errors with
  absent/distinct Causes are copied without caller mutation; hostile Proxies
  fall back safely.
- Cause transformation is iterative postorder with identity memoization. It is
  stack-safe for 12,000-level regression witnesses and preserves shared/DAG
  node identity across loader, resolver, compiler, and validator paths.

### Exact commits

The accepted range `ba4b8b0..f6af08e` contains 21 commits:

1. `1ec081b` — define JSON Schema runtime RED contract.
2. `e72d95f` — ship exact Ajv runtime dependency.
3. `819c0dd` — add bounded JSON Schema runtime.
4. `cee39da` — validate registered tool outputs.
5. `ebfe717` — install packed runtime dependencies generically.
6. `78f0acc` — expose initial review/coordinator regressions.
7. `878b265` — keep schema diagnostics local.
8. `9f82d78` — contain resolver boundaries and canonical aliases.
9. `6d33a77` — own validator callback boundaries.
10. `e217834` — align tool input schema behavior.
11. `a443566` — align inherited schema expectation with 2020-12.
12. `1c4dc28` — expose mixed callback Causes and compatibility traversal.
13. `433d8f5` — preserve Cause structure and traverse `dependencies`.
14. `8aa1642` — expose incomplete typed schema Causes.
15. `a36caa9` — complete absent typed schema callback Causes.
16. `e87ec79` — expose distinct typed schema Causes.
17. `f2573f9` — replace stale typed schema Causes without mutation.
18. `33520ac` — expose hostile typed schema failures.
19. `9c6bc64` — contain hostile typed-error recognition.
20. `5f8405e` — expose deep schema callback Causes.
21. `f6af08e` — map deep Causes iteratively.

### Review and TDD history

- Initial review at `ebfe717`: 0 Critical / 4 Important / 0 Minor. It found
  external URI leakage, post-normalization root-byte accounting, escaping
  synchronous callbacks, and mutable compiled methods.
- Coordinator review added explicit 2020-12 Effect inputs, canonical resolver
  aliases, strict argument agreement, and typed unsupported generation.
- Rereviews then found incomplete mixed interruption, missing schema-valued
  `dependencies`, typed errors without the enclosing Cause, typed errors with a
  distinct existing Cause, hostile Proxy recognition, and recursive deep-Cause
  overflow. Every finding received a committed failing witness before its
  production correction.
- Final rereview reproduced every cumulative/remediation/package hash, passed
  hostile/deep focused tests, and independently preserved interruption at
  depths 8,000, 12,000, and 20,000 with 0 defects.

Final immutable identity:

- Candidate tree: `ae6c28cbf8f29e0392bd32f57feadbadaf08cf6d`
- Cumulative binary diff SHA-256:
  `e0f04e5f9bb79443db4525a1cdd568f280aa924db3cdfdad89c626ff440060e2`
- Final-remediation binary diff SHA-256:
  `33cc6efdbe41ae6a96f93af8d05a13ac5a14a15579ed1c897c3330c81ce9f756`
- Diff-package SHA-256:
  `7f4e733b4b1dae637426868f714ec6588a311215eb4df85dbfc6a318a5e241c8`
- Review package: `.superpowers/sdd/task-5c-stack-safe-rereview-package.md`

### Accepted-candidate verification

Node `v22.22.3`, Corepack/pnpm `10.11.1`:

- Fresh `pnpm run test:wp5c`: exit 0. WP5A 66/66; WP5B client 32/32,
  server 25/25, package 11/11; WP5C schema 36/36 and output 37/37; all public
  type fixtures passed.
- Fresh elevated loopback-enabled `CI=true pnpm run verify`: exit 0. WP3,
  accepted WP4 wire/dispatcher/stdio/HTTP 116/transport, cumulative WP5C,
  public types, WP2 17/17, source refresh 3/3, Tier operations 10/10,
  unit/integration, and both draft E2E scenarios twice passed.
- Coordinator stress probe mapped a 100,000-level shared Cause in about 18 ms,
  preserving the parallel tail and shared interrupt identity.
- `git diff --check` and tracked status were clean at the accepted candidate.

Official draft-targeted conformance, release provenance/stability,
documentation publication, agent evidence, PR disposition, and Tier claims
remain truthfully unresolved and outside Task 5C acceptance.

## Task 5D: deterministic pagination and scoped caching

Status: accepted at code head
`23689b64e7b884d6c523992ea1df72ee8b2dcbe4` after final independent immutable
rereview of evidence head `ac133502ef8b62e8e59ee8ec15c616442f94e3dc`
returned specification PASS, code quality PASS, 0 Critical, 0 Important,
1 Minor, and verdict `APPROVE`. This is not an official conformance, release,
or Tier claim.

### Candidate behavior

- Tools, resources, resource templates, and prompts are filtered by the live
  request view, sorted by exact JavaScript UTF-16 code-unit order, and paged
  under a snapshotted policy. Defaults are 100 items, `ttlMs: 0`, and private
  scope. Terminal pages omit `nextCursor`; an own empty custom cursor remains
  present and reusable.
- The stable server boundary exposes only the approved pagination policy,
  cursor state/service, collection union, and bounded platform-free memory
  constructor. Default tokens use a strict opaque owner/token grammar, FIFO
  capacity 1,024, five-minute lifetime, and per-server isolation. Malformed,
  foreign, expired, evicted, restarted, wrong-collection, stale-revision,
  changed-view, and hostile states fail safely without token/state leakage.
- Registry upserts replace by primary identity and remove replaced prompt or
  template completion handlers. Registration and explicit list-change first
  invalidate affected cursor state, then atomically commit registry/revision
  and notification visibility. Failed invalidation leaves all four registries,
  completions, revisions, and notifications unchanged.
- The stable client boundary exposes only the approved `McpCache` types,
  service, authorization provider/value, error, and bounded memory constructor.
  The default cache is per-service LRU 256. Omitted namespaces are client-local;
  explicit namespaces permit public sharing. Private cache use requires the
  explicit anonymous or authorized partition; the unpartitioned default
  bypasses private lookup/storage.
- Exact generated complete results for discovery, four list methods, and
  resources/read are cached as canonical wire JSON only when `ttlMs > 0`.
  Keys include namespace, method, strict non-meta params, protocol version,
  and canonical request capability/extension profile. Request IDs, tracing,
  progress/log metadata, client info, and raw authorization are excluded.
- Freshness is half-open and safe-integer saturated. Every hit is
  descriptor-safely snapshotted and exact-decoded. Corrupt, hostile, or stale
  entries become misses only after successful invalidation; configured cache
  infrastructure failures fail the request with a typed Cache error and local
  original Cause. Category epochs prevent stale in-flight repopulation.
- List-change invalidation covers every page plus discovery before notification
  exposure; resource list-change also covers templates and resource-updated
  targets the exact read URI. Explicit discovery force-refreshes.
- The hidden HTTP tool-plan catalog remains transport-owned. Paginated pages,
  including `cursor: ""`, merge; an unpaginated list replaces; tools-list-change
  clears global and request-local plans before the frame is exposed. Cached
  tools never synthesize header plans and accepted one-refresh mismatch repair
  is unchanged.
- No generated output, dependency, WP5E+, authorization, Tasks, Apps, release,
  publication, final-spec, or Tier behavior changed.

### Exact candidate commits

The implementation range `241b883..bb73172` contains 14 commits:

1. `664e0f0` — define pagination and cache RED contract.
2. `0e2e55b` — expose pagination and cache edge cases.
3. `871cee2` — remove a vacuous empty-cursor leak witness.
4. `e08f57b` — add deterministic server pagination.
5. `dcee45a` — expose hostile cursor and stale completion state.
6. `c8af7a3` — contain pagination registry edge cases.
7. `273a238` — make cache-result overrides behaviorally meaningful.
8. `248d5eb` — witness typed cache construction.
9. `238cabe` — add scoped client result caching.
10. `193c97c` — clear HTTP tool plans on list changes.
11. `be05c04` — witness truthful pagination invalidation error channels.
12. `3d35cc5` — require atomic pagination invalidation.
13. `388e0cf` — witness the remaining template error channels.
14. `bb73172` — make pagination invalidation and registry mutation atomic.

### TDD and correction evidence

- Tests-only commits preceded each production surface. The initial server,
  cache, HTTP catalog, type, and package witnesses failed on the absent public
  APIs and behavior while accepted WP5C stayed green.
- Focused RED expansion exposed a cursor state accessor attack and stale
  template/prompt completions before `c8af7a3` corrected both.
- Cache helper/type fixture corrections `273a238` and `248d5eb` were committed
  before client production and prevented vacuous override and inferred-`never`
  witnesses.
- The first exact full verify after the cache/HTTP implementation failed only
  two truthful public type gates: cursor invalidation made registry Layer
  construction capable of local `SchemaValidationError`. Tests-only commits
  `be05c04` and `388e0cf` recorded the intended error channels and caught an
  existing template overload generic-order defect.
- Runtime RED `3d35cc5` then proved custom invalidation failure mutated the tool
  registry before failing. GREEN `bb73172` invalidates before mutation, batches
  resource/template invalidation atomically, exposes notifications only after
  commit, and corrects the template overload order. The focused server suite
  passes 19/19 including the all-collection atomicity witness.

### Candidate verification

All counted commands used Node `v22.22.3` and pnpm `10.11.1` through Corepack.

- `CI=true pnpm run check:type-fixtures`: pass.
- `CI=true pnpm run test:wp5d-pagination`: 19/19 plus build, exit 0.
- `CI=true pnpm run test:wp5d`: exit 0. Cumulative WP5A 66/66; WP5B client
  32/32, server 25/25, package 11/11; accepted WP5C schema/output and all
  public type fixtures; WP5D pagination 19/19, cache 18/18, HTTP catalog 1/1,
  package 11/11, and types all passed.
- Exact loopback-enabled `CI=true pnpm run test:wp4-transports`: 12/12 plus
  its public type fixture, exit 0.
- Exact loopback-enabled `CI=true pnpm run verify`: exit 0. It included source
  pins, Effect foundation/single-runtime, generated/invariant checks, build,
  frozen SDK parity, accepted WP3/WP4/WP2 gates, cumulative WP5D, schema/type/
  runtime/extension checks, unit/integration, both draft E2E scenarios, and
  readiness accounting.
- `git diff --check` passed and tracked status was clean at candidate head.

The readiness compiler still truthfully reports official draft-targeted
conformance, release provenance/stability, published documentation, and agent
evidence as blocked/partial. Those later gates are not WP5D implementation
failures and remain unresolved.

### Independent review boundary and known review focus

- First immutable review at `4fb774f` returned `CHANGES REQUIRED`: 0 Critical,
  5 Important, and 2 Minor findings. Reviewer probes reproduced stale hits from
  delayed cache get/set races, resource-only invalidation clearing tool/prompt
  cursors, coercing cursor-object acceptance, discarded callback Cause
  evidence, exposed mutable server pagination internals, order-sensitive
  equivalent profile keys, and the unrelated cursor/cache type witness.
- Tests-only RED `e343945` added deterministic delayed-get and delayed-set epoch
  races, reversed nested capability/extension insertion order, and the truthful
  `PaginationCursor.memory` `SchemaValidationError` assignment. Exact Node 22
  cache result: 18 pass / 3 intended fail; the corrected public type fixture
  passed.
- GREEN `5aeb357` checks the category epoch after cache get before hit return,
  invalidates a late write when the epoch changed during set, preserves
  invalidation failure ownership, and recursively encodes strict-JSON cache
  keys with exact deterministic code-unit key order. Cache passes 21/21 and
  public types pass.
- Tests-only RED `9567343` added exact scoped resource/template invalidation,
  tool/prompt cursor survival, non-coercing memory resolve, complete local
  callback Cause ownership/topology/interruption with value-safe diagnostics,
  runtime/compiler absence of the three pagination internals, and replaced the
  weak cursor/cache witness. Exact Node 22 server result: 18 pass / 4 intended
  fail; the public type fixture failed only because all three private keys were
  still in `McpServerService`.
- GREEN `23689b6` changes cursor invalidation to one frozen exact collection
  array, validates memory selectors, rejects non-string cursors before regex,
  attaches the complete original Cause non-enumerably without serializing it,
  and moves owner/cursor/revisions to a module-private `WeakMap`. The only
  server clone is the HTTP filtered-tool view; a narrowly internal helper
  preserves its runtime and is not exported from `./server`. Server pagination
  passes 22/22, public types pass, and the HTTP server integration passes 60/60.
- Exact Node 22 cumulative `pnpm run test:wp5d` and approved loopback
  `CI=true pnpm run verify` both pass at the remediation head. The full gate
  includes accepted WP2-WP4, cumulative WP5D, HTTP 116/116, generated/schema/
  package/type/runtime checks, unit/integration, and both draft E2E scenarios.
- Fresh rereview must reproduce the accepted WP5C/report base, prior review
  head, remediation head/tree, cumulative/remediation binary diff hashes,
  inspect every finding resolution and regression boundary, and rerun focused
  evidence.

### Final immutable rereview and acceptance

- The final independent rereviewer reproduced the accepted WP5C/report base,
  prior review head/tree/package hash, remediation code/evidence heads and
  trees, cumulative/remediation/evidence binary diff hashes, diff-check, and
  clean tracked status exactly.
- Exact identities reproduced include code head `23689b6`, code tree
  `79de32814ca27255ee08ad145d91f6f0f77be6b8`, evidence head `ac13350`, and
  evidence tree `acbb713042e9de4cc89e9490621990a3e108ec64`.
- The reviewer ran exact Node `v22.22.3` `CI=true pnpm run test:wp5d`: exit 0.
  Pagination passed 22/22, cache 21/21, HTTP catalog 1/1, public types passed,
  and package passed 11/11; the cumulative accepted WP5A-WP5C gates also
  remained green.
- All five Important and both original Minor findings were adjudicated as
  resolved. Specification compliance PASS and code quality PASS; final finding
  counts were 0 Critical, 0 Important, and 1 Minor; verdict `APPROVE`.
- The remaining Minor is confined to direct custom use of `McpCache.memory`:
  exotic non-strict key objects can alias ordinary strict JSON when differences
  exist only in non-enumerable properties, accessors/prototype exactness, or
  similar object shape outside the encoded enumerable strict-JSON value. Normal
  `McpClient` use is not affected because client-generated params and profiles
  are descriptor-safe canonical strict snapshots before key construction.
- One additional low-risk hardening observation remains: direct callers can
  provide a cursor invalidation selector array with extra enumerable
  non-index properties because the bounded memory service validates the dense
  indexed values but does not currently reject every extra array key. Server
  calls always pass a freshly frozen exact array. Both observations are
  explicit nonblocking follow-up candidates; neither was silently changed in
  this acceptance closeout.
- The reviewer did not rerun full `CI=true pnpm run verify`. Implementer exact
  Node 22 loopback-enabled full verify at remediation code head `23689b6` had
  already passed, including HTTP 116/116, transports 12/12, unit/integration,
  and both draft E2E scenarios; coordinator cumulative Node 22 WP5D was also
  green.
- No official conformance, release, publication, Tier, Goal-completion, or
  WP5E+ claim/action is included in Task 5D acceptance.

## Task 5E candidate pending independent review

Task 5E implements request-owned progress and cancellation at code head
`7934ddaed115aa0f495cd9be306bdca5630a6e38`. It is a verified candidate, not
an accepted work package.

### Frozen boundary and TDD history

- Coordinator-approved preflight is retained in the ignored recovery artifact
  `.superpowers/sdd/task-5e-preflight.md`.
- Tests-only RED `d5fe736` defined the stable request facade, token-derived
  server progress, owner-local send/terminal ordering, hostile-safe client
  request options, exact active-token reservations, sequential callback/global
  notification ordering, callback Cause containment, and direct interruption.
- Tests-only correction `3fa0552` fixes one internally inconsistent witness:
  the public contract and type fixture define `cancelled` as an `Effect<void>`,
  so the runtime test now yields that Effect directly rather than passing it to
  `Deferred.await`.
- Server GREEN `c89f338` adds a physically distinct stable request context,
  derives progress tokens without exposing the deep dispatcher sink, and
  serializes owned notification and terminal writes while preserving the raw
  deep WP4 sink.
- Client GREEN `16bbdfb` adds descriptor-only options snapshotting before
  target providers/cache/transport, strict type-sensitive token reservations,
  generated progress decoding and semantic ownership checks, sequential
  callback then global dispatch on the existing stream, and complete local
  Cause/interruption containment.
- WP4 regression fix `5665924` keeps cancellation's atomic phase claim
  nonblocking while a terminal write is pending. Terminal and cancellation
  still compete on the exact phase; cancellation cannot wait behind a terminal
  that has already won.
- Runtime smoke update `7934dda` exercises `sendProgress` through a real owned
  `tools/call` instead of the removed global publication behavior.

No generated source, dependency, lockfile, WP5F+, authorization, Tasks, Apps,
remote, release, conformance, Tier, or Goal-completion change is included.

### Implementer verification

Runtime: Node `v22.22.3`, pnpm `10.11.1`.

- `pnpm run test:wp5e-server`: 12/12, exit 0.
- `pnpm run test:wp5e-client`: 14/14, exit 0.
- `pnpm run test:wp5e-types`: exit 0.
- `pnpm run test:wp5e-package`: 11/11 plus exact public declarations,
  packed-consumer, type, and platform-free checks, exit 0.
- `CI=true pnpm run test:wp5e`: complete cumulative WP5A-WP5E gate, exit 0.
- `CI=true pnpm run test:wp4-dispatcher`: 31/31 plus public types, exit 0.
- `CI=true pnpm run test:wp4-stdio`: 22/22 plus public types, exit 0.
- Approved loopback `CI=true pnpm run test:wp4-http`: 116/116 plus public
  types, exit 0. The first sandbox run failed only the two real loopback binds
  with `EPERM`; the approved rerun distinguished that environment restriction
  from product behavior.
- `CI=true pnpm run test:wp4-transports`: 12/12, exit 0.
- Approved loopback exact `CI=true pnpm run verify`: exit 0. Sources, Effect
  foundation/single-runtime, generated/invariants, build, frozen parity, WP3,
  WP4, cumulative WP5E, public types, WP2, SDK/schema/runtime/extensions,
  source refresh, Tier operations, unit/integration, and both draft E2E
  scenarios passed.
- `git diff --check`: pass; tracked status clean before candidate evidence.

The readiness compiler still truthfully reports official draft-targeted
conformance, release provenance/stability, published documentation, and agent
evidence as blocked or partial. Green repository health is not official
conformance, release readiness, Tier completion, Goal completion, or WP5E
acceptance.

### First independent review and remediation candidate

The first immutable independent review of `75d6df5..77e3d6b` returned
`CHANGES REQUIRED` with 0 Critical, 4 Important, and 2 Minor findings. The
review found a handler-mutable facade token, non-exact and trap-leaking public
server progress inspection, message-based callback-error impersonation, and a
cancellation/send race that could expose cancellation before an already-owned
uninterruptible send committed. It also found the corrected code-head typo
above and that the catalog client example omitted a real progress option.

Remediation preserves the accepted boundary and is frozen at code head
`e4d43bd8348d55cb74476d91e22bd2e8735d0490` pending fresh independent
rereview:

1. `439c9998f8c3a77fe188e45711b4ded07a5cc85e` — supplemental tests-only RED for every Important finding, the example regression, and deep/DAG controls.
2. `3c78ea8` — exact-own contained progress inspection plus privately authoritative immutable token ownership.
3. `f699223` — uninterruptible `CancellationPending` drain before cancellation signal and handler interruption.
4. `9ad2ff2` — module-private `WeakMap` branding for callback failure restoration.
5. `e4d43bd` — real typed progress options in the catalog client example.

Supplemental Node `v22.22.3` RED was meaningful and deterministic. Server
exited 1 with 26 tests, 14 pass, 12 failures and 0 cancelled; client exited 1
with 19 tests, 17 pass and 2 failures. The 20,000-node sequential Cause and
shared-DAG controls remained green. After GREEN, server passes 26/26 and client
passes 19/19.

Exact remediation verification on Node `v22.22.3`, pnpm `10.11.1`:

- `CI=true pnpm run test:wp5e`: exit 0, including cumulative WP5A-WP5E,
  public types, and package proof.
- `CI=true pnpm run test:wp4-dispatcher`: 31/31 plus public types, exit 0.
- `CI=true pnpm run test:wp4-stdio`: 22/22 plus public types, exit 0.
- `CI=true pnpm run test:wp4-transports`: 12/12, exit 0.
- Restricted `CI=true pnpm run test:wp4-http`: 114/116; the only failures
  were the two real loopback binds returning `EPERM`. Identical approved
  rerun: 116/116 plus public types, exit 0.
- Approved loopback `CI=true pnpm run verify`: exit 0. It includes every
  inherited source/generated/invariant, WP2-WP5E, package/type/runtime,
  HTTP 116/116, unit/integration, and both draft E2E scenarios. Readiness
  accounting remained internally consistent and still reports Tier/release/
  documentation/agent-evidence blockers truthfully.
- `git diff --check 75d6df5..e4d43bd`: pass.

Frozen remediation identity before tracked evidence:

- Code tree: `a3e85b0b414e381a505007a697b667e9b5773885`
- Cumulative binary diff SHA-256 (`75d6df5..e4d43bd`):
  `5fae9e7fc00fe27fc42e3c7804005b0c2b15b600d983caea0c8d6fbd209f3525`
- Remediation binary diff SHA-256 (`77e3d6b..e4d43bd`):
  `b10dc6bf15d4b00bb612520ffdb259ae9f77cc6a64ac2f97a2b38ad9da4af5aa`
- Supplemental RED binary diff SHA-256 (`77e3d6b..439c999`):
  `de211bcca12f05ede24cb8d32973beb7116c5d43af559b3c4dafba65252da731`

No WP5F+, remote, official conformance, release, publication, Tier,
acceptance, or Goal-completion action or claim is included in this
remediation candidate.

### Final remediation rereview and acceptance

The fresh independent immutable rereview of remediation evidence head
`3c34beff969930bbdbe8431a5c6f29c3dd9e6b0f` reproduced every recorded
base, prior-review, RED, remediation-code, and evidence head; every tree and
binary diff hash; the first review-package hash; diff-check; and clean tracked
status exactly.

All six first-review findings passed fresh adjudication: the four Important
findings and both Minor findings are resolved. All ten original compliance
groups passed, including the known stack-safe Cause focus. The reviewer ran
exact Node `v22.22.3` gates: server 26/26, client 19/19, cumulative WP5E,
dispatcher 31/31, stdio 22/22, transports 12/12, and approved-loopback HTTP
116/116; every command exited 0. Final result: specification compliance PASS,
code quality APPROVED, 0 Critical, 0 Important, 0 Minor, verdict `APPROVE`.
WP5E request-owned progress and cancellation is accepted at code head
`e4d43bd8348d55cb74476d91e22bd2e8735d0490`.

The reviewer did not rerun full `CI=true pnpm run verify`. Implementer exact
Node 22 loopback-enabled full verify at the accepted code head was already
green, including inherited source/generated/invariant and package/type/runtime
gates, integration, HTTP 116/116, and both self-hosted draft E2E scenarios.

Acceptance is bounded to WP5E repository behavior. It is not official MCP
conformance, release readiness, publication, Tier completion, or Goal
completion. No remote, PR, release, WP5F+, Tier, or Goal-state action was
taken by this evidence closeout; later work still requires its own governed
authorization and gates.

## Task 5F candidate pending independent review

Task 5F implements bounded/manual MRTR, stable Elicitation policy, exact
server continuations, and secure replay-safe request state. It is a verified
candidate, not an accepted work package.

### Frozen boundary and TDD history

- Tests-only RED `ff26105` defined automatic/manual policy, the ten-round and
  32-request hard limits, concurrency four, exact keys/state, fresh IDs,
  reentrancy, generated input validation, capability ownership, URL denial,
  form validation, server `requestInput`, and public types. Node 22 runtime was
  0/10 client and 0/5 server; types reported the intended missing API errors.
- Tests-only correction `e69bb1c` removes one inconsistent negative witness:
  the coordinator-approved contract permits automatic callers to begin from
  an explicit continuation.
- Tests-only correction `45d0a5d` constructs own `__proto__` data properties
  instead of invoking JavaScript object-literal prototype syntax.
- Client GREEN `060f683` adds generic mode-aware `McpClient`, stable
  `InputRequiredPolicy`, generated handler/result validation, bounded automatic
  MRTR, manual unions, policy-owned capabilities, exact continuation maps, and
  complete handler Cause containment.
- Server GREEN `c02a347` adds capability-checked `requestInput`, exact
  input-required result encoding, typed handler error propagation, and a
  narrow three-method dispatcher reconstruction after generated validation so
  own `__proto__` response keys survive Effect typed-record materialization.
- Tests-only secure-state RED `3ba1c69` produced 0/6 intended runtime failures
  and seven intended type diagnostics. Supplemental RED `c4b8dd9` proved a
  replay store that throws before returning an Effect was not yet contained.
- Secure-state GREEN `4bbed29` adds global-WebCrypto-only AES-256-GCM sealing,
  copied/nonextractable 32-byte keys, 96-bit IV, 128-bit tag and replay nonce,
  versioned canonical base64url, principal/purpose AAD, bounded state/token/
  timestamps, an atomic bounded fail-closed replay service, complete store
  Cause containment, and separately named `HarmlessRawRequestState`.
- Compatibility/public evidence commits `82092a3` and `5c05164` migrate prior
  tests off deprecated implicit tags and register the exact runtime,
  declaration, platform-free, and packed-consumer surface. Documentation
  commit `2143a3c` records secure versus harmless raw-state operation.

No dependency, lockfile, generated source, WP5G+, authorization, Tasks, Apps,
remote, PR, official conformance, release, publication, Tier, acceptance, or
Goal-state change is included.

### Implementer verification

Runtime: Node `v22.22.3`, pnpm `10.11.1`.

- `pnpm run test:wp5f-client`: 10/10, exit 0.
- `pnpm run test:wp5f-server`: 5/5, exit 0.
- `pnpm run test:wp5f-state`: 6/6, exit 0.
- `pnpm run test:wp5f-types` and `pnpm run test:wp5f-state-types`: exit 0.
- `pnpm run test:wp5f-policy`: complete focused runtime/type gate, exit 0.
- `pnpm run test:wp5e`: complete cumulative accepted WP5A-WP5E regression,
  exit 0. Visible component evidence includes WP5A 66/66, WP5B client 32/32,
  server 25/25, package/subpaths 11/11 plus types, and every WP5C/D/E command.
- `pnpm run test:wp4-transports`: 12/12, exit 0.
- Exact `pnpm run verify`: exit 0. Sources, Effect foundation/single-runtime,
  workflow, generated/invariants, build, frozen parity, WP3, WP4, cumulative
  WP5E, public types/package, WP2, SDK/schema/runtime/extensions, source
  refresh, Tier operations, unit/integration, and both draft E2E scenarios
  passed.
- `git diff --check c4d4755..2143a3c`: pass; tracked status clean before
  candidate evidence.

The readiness compiler remains truthful about unresolved official
draft-targeted conformance, release provenance/stability, published
documentation, and agent evidence. Green local gates are not official MCP
conformance, release readiness, Tier completion, Goal completion, or WP5F
acceptance.

### Frozen code identity before tracked evidence

- Accepted WP5E/report base: `c4d47552009193174ab9ce5b6c3867ef290b9151`
- Base tree: `ffe5600281ddcea08ae748d0117b097980ae1544`
- WP5F code head: `2143a3c6b6d189f1728dc63153a60c3a86f9a25b`
- Code tree: `b494c864ab240a848fd4c64b62765984f4813fc1`
- Code binary diff SHA-256 (`c4d4755..2143a3c`):
  `13bb58db68e5389150f2b5d559cbee4c90f2e9086b404898f0d8d96f67a8a9c2`

Fresh immutable review must reproduce the accepted base, code/evidence heads
and trees, code/evidence/evidence-only binary diff hashes, clean tracked
status, and diff-check before reviewing both specification compliance and code
quality. No review begun before the evidence freeze can accept this candidate.

### First independent review and remediation candidate

The first immutable independent review of evidence head `50572dd` returned
`CHANGES REQUIRED` with 0 Critical, 8 Important, and 1 Minor finding. It found:

1. malformed UTF-16 principal/purpose strings could alias after UTF-8 encoding;
2. hostile configuration/input getters and Proxies could escape the typed
   request-state boundary;
3. client handler and replay-store mixed Causes flattened interruption into an
   ordinary typed failure;
4. restricted form validation omitted `date`, `date-time`, `email`, and `uri`
   formats and counted UTF-16 code units instead of Unicode code points;
5. non-string `requestState` could defect and resource-template input-required
   failures were rewritten as `InternalError`;
6. the specified five-minute secure-state TTL default was absent;
7. a rejected wrong-length key copy was not zeroed; and
8. `InputRequiredPolicy.automatic` allowed a spread-supplied manual mode to
   override its constructor invariant.

The Minor finding identified an interruption assertion whose original setup
only produced an ordinary failure. The supplemental Cause witnesses now use
deterministic explicit interrupt nodes and exercise both pure and mixed
interruption.

Remediation preserves the frozen WP5F boundary and is frozen at code head
`430dfcbf83b16ff7e91d3909c0810613eaf9aef5` pending fresh independent
rereview:

1. `3238e70` — supplemental tests-only RED for the eight Important findings
   and corrected interruption witness;
2. `7e4c968` — tests-only RED requiring rejected temporary key zeroing;
3. `3d20d16` — correct the zeroing witness to observe the shared typed-array
   intrinsic without mutating caller bytes;
4. `7254e09` — descriptor-safe automatic policy construction, structural
   handler Cause mapping, all generated restricted string formats, and
   code-point length semantics;
5. `a7e313d` — exact server continuation options, typed request-state
   validation, and resource-template error preservation; and
6. `430dfcb` — descriptor-safe secure-state boundaries, five-minute default,
   well-formed UTF-16 enforcement, structural replay-store Cause mapping, and
   unconditional temporary-key-copy zeroing.

Supplemental Node `v22.22.3` RED was meaningful and deterministic. Client
reported 11 tests, 7 pass and 4 intended failures; server reported 7 tests,
4 pass and 3 intended failures; secure state reported 8 tests, 3 pass and
5 intended failures. The secure-state type fixture also failed on the missing
TTL default. After GREEN, client passes 11/11, server passes 7/7, secure state
passes 8/8, and both type fixtures pass.

Exact remediation verification on Node `v22.22.3`, pnpm `10.11.1`:

- `pnpm run test:wp5f-policy`: exit 0; client 11/11, server 7/7, secure state
  8/8, and both public type fixtures passed. The coordinator independently
  reproduced this exact focused gate at clean code head `430dfcb`.
- `pnpm run test:wp5e`: complete cumulative accepted WP5A-WP5E regression,
  exit 0.
- `pnpm run test:wp4-transports`: 12/12, exit 0.
- Exact `pnpm run verify`: exit 0. It includes inherited source/generated/
  invariant, WP2-WP5E, package/type/runtime, HTTP/integration, and both
  self-hosted draft E2E gates; this remains repository health, not official
  MCP conformance.
- `git diff --check`: pass; tracked status clean at the remediation code head.

Frozen remediation identity before replacement tracked evidence:

- Accepted WP5E/report base: `c4d47552009193174ab9ce5b6c3867ef290b9151`
- Original WP5F code head/tree: `2143a3c6b6d189f1728dc63153a60c3a86f9a25b` /
  `b494c864ab240a848fd4c64b62765984f4813fc1`
- Original evidence head/tree: `50572dd` /
  `c2fc7d65840d84cf7b6659e83dfd8be617c13885`
- Original review-package SHA-256:
  `f71d2ba4cdc98d89032c0b3392957d955ee64333ca17d3b00c31379c7902fb23`
- Remediation code head/tree: `430dfcbf83b16ff7e91d3909c0810613eaf9aef5` /
  `9b42d6699dd3aaf01d386c7b98a4205baad2f992`
- Cumulative binary diff SHA-256 (`c4d4755..430dfcb`):
  `5cc5f7e6ff44683ccb27b0a8e4afd73ce2b3101b2f97dab5101e5d4eac774df1`
- Remediation binary diff SHA-256 (`50572dd..430dfcb`):
  `ab418eb8becf49e5c50077d28326ac285b2c25c03c00e5dd5c98c17d3827525f`
- Supplemental RED binary diff SHA-256 (`50572dd..3d20d16`):
  `786b771f6856924dbb82e83bcf203b2660e71489ff6b37f12c3cdb65cb48a3d7`
- Original evidence-only binary diff SHA-256 (`2143a3c..50572dd`):
  `e43b296d0ee5a96ac6cd7bf6fe83e235298c1c9c5d3731adb8a790e545df7b71`

No WP5F acceptance, WP5G+, remote, PR, official conformance, release,
publication, Tier, or Goal-completion action or claim is included in this
remediation candidate. Fresh immutable rereview must reproduce the replacement
evidence head, every recorded tree and binary diff hash, review-package hash,
clean tracked status, and diff-check before adjudicating all nine findings and
the full frozen WP5F specification.

### Restricted-format residual hardening and final code candidate

The first remediation rereview correctly stopped without a verdict because a
new standards-oracle test was being added while it reproduced the preceding
freeze. All pinned identities matched, but tracked status was dirty, so the
package's stop-on-drift rule applied. That superseded package and interrupted
review are not acceptance evidence.

The committed preservation path retains the new focused witness and does not
add or promote a runtime dependency:

1. `96caf3d` — tests-only RED compares bounded MRTR validation with the
   repository's existing development-only `ajv-formats` full-mode oracle for
   Gregorian dates, RFC3339 leap seconds/calendar/timezone bounds, common
   email boundaries, RFC3986 percent escapes, absolute URI versus relative
   reference, and URI versus Unicode IRI inputs.
2. `f90e608` — bounded GREEN accepts RFC3339 leap seconds and oracle offset
   forms, aligns common email-format behavior, and rejects malformed percent
   escapes, backslashes, controls, and non-ASCII IRI input at the URI boundary.
   Production continues to use no `ajv-formats` import or new dependency.
3. `dfb9d7b` — isolated formatting cleanup for the secure-state code introduced
   by this WP5F remediation; no behavior changes.

The focused RED was independently reproduced on Node `v22.22.3`: client outer
results were 9 pass and 2 fail, with the first intended mismatch the valid
RFC3339 leap second `2024-06-30T23:59:60Z` returning `Left` while the oracle
returned `Right`. After GREEN, the full client suite passes 11/11, including
all 18 oracle-backed valid/invalid format cases and the Unicode code-point
length witness.

Final-code verification on Node `v22.22.3`, pnpm `10.11.1`:

- `pnpm run test:wp5f-policy`: client 11/11, server 7/7, secure state 8/8,
  both type fixtures pass, exit 0.
- `pnpm run test:wp5e`: complete cumulative accepted WP5A-WP5E regression,
  exit 0.
- `pnpm run test:wp4-transports`: 12/12, exit 0.
- Exact `pnpm run verify`: exit 0, including inherited source/generated/
  invariant, WP2-WP5E, package/type/runtime, HTTP/integration, and both
  self-hosted draft E2E gates.
- `git diff --check c4d4755..dfb9d7b`: pass; tracked status clean.

Final code identity before final replacement evidence:

- Code head/tree: `dfb9d7bb34156ee5c8a06963e26ee093ad30bc7b` /
  `edfcace69ddd1d35ba2bc71e9d016637cc43295f`
- Cumulative code binary diff SHA-256 (`c4d4755..dfb9d7b`):
  `d598bb643480249a2a1e9147d9e65a12db8809faf9191d44b81b90f417d9862a`
- Final residual range SHA-256 (`0194235..dfb9d7b`):
  `a445126d87756aedfa628a26eb4bba871cf54642cd58fac6d3f6b5d7b2a1809b`
- Format-oracle RED SHA-256 (`0194235..96caf3d`):
  `a308b26510dd5ef18ddd07377818625351bad5b43f274839aa76b34eeecf252f`
- Format GREEN/cleanup SHA-256 (`96caf3d..dfb9d7b`):
  `6b5395ef2b49f98c65d92ba20f1da05002f014cc26a1be8cd4282ced9b1d8870`

WP5F remains a candidate pending a clean fresh immutable rereview. No WP5F
acceptance, WP5G+, remote, PR, official conformance, release, publication,
Tier, or Goal action or claim is included.

### RFC 3986 rereview correction and final-final code candidate

The fresh review of final evidence head `2bed4ce` returned
`CHANGES REQUIRED`: 0 Critical, 1 Important, 0 Minor. Every identity and hash
reproduced, all eight earlier Important findings and the original Minor finding
were resolved, nine of ten compliance groups passed, and exact-map scope
passed. The remaining Important finding was that WHATWG `new URL` did not
match the frozen `ajv-formats` full-mode RFC 3986 oracle. Automatic MRTR
reproduced both directions: valid `http://[v1.fe]/` was rejected and invalid
`foo:` was accepted, with related opaque, authority, port, user-info, and
IPv4-looking edge mismatches.

The correction is bounded and retains the no-new-runtime-dependency decision:

1. `4311a89` — tests-only automatic-path RED extends the existing development
   oracle matrix with valid/invalid IPvFuture, empty opaque/query/fragment,
   empty authority, unusual port, IPv4-looking host, user-info, opaque-path,
   malformed percent/generic character, Unicode IRI, and relative-reference
   witnesses. The first deterministic failure remains valid IPvFuture
   `http://[v1.fe]/` returning `Left` instead of oracle `Right`.
2. `0a17fc2` — bounded GREEN replaces WHATWG URL normalization with a locally
   owned RFC 3986 URI assertion derived from the pinned `ajv-formats` 3.0.1
   full-mode oracle. There is no runtime import, dependency, or lockfile change.
3. `19d9c3c` — audit/licensing attribution pins the exact upstream 3.0.1 source
   URL and preserves the upstream MIT notice in `THIRD_PARTY_NOTICES.md`.

Final-final Node `v22.22.3`, pnpm `10.11.1` verification:

- `pnpm run test:wp5f-policy`: client 11/11, server 7/7, secure state 8/8,
  both type fixtures pass, exit 0.
- `pnpm run test:wp5e`: complete cumulative accepted WP5A-WP5E regression,
  exit 0.
- `pnpm run test:wp4-transports`: 12/12, exit 0.
- Exact `pnpm run verify`: exit 0, including inherited source/generated/
  invariant, WP2-WP5E, package/type/runtime, HTTP/integration, and both
  self-hosted draft E2E gates.
- `pnpm run build` and `git diff --check`: pass; tracked status clean.

Final-final code identity before replacement evidence:

- Code head/tree: `19d9c3cdd4f6ae936dcecda9c1550681b58a53b1` /
  `8b2191fa8efa3abc0194d09bccef5788caef7302`
- Cumulative code SHA-256 (`c4d4755..19d9c3c`):
  `1c7805eb5c08a99e4de226d5a293f39e9f64af80d8ce2108b353add153479148`
- RFC 3986 remediation SHA-256 (`2bed4ce..19d9c3c`):
  `41b12fdbe41a4f337730fd29ad40174af244113c645a6d3ae7083c12f106c5bf`
- RFC 3986 RED SHA-256 (`2bed4ce..4311a89`):
  `e03e1a0be1bd460e08fabd0aea033f43dbccc8b307d1d21a7143763791de6501`
- RFC 3986 GREEN/attribution SHA-256 (`4311a89..19d9c3c`):
  `02d2d3455ee010e72418d4c4b1c1afa7b87632e08ed71dfa551ed05092b5895d`
- Superseded final-package SHA-256:
  `0e3995d378c1d3a15182ceda471ea3858fd454d1e4212b82e74c0933ad31d8d7`

WP5F remains unaccepted pending one more clean fresh immutable rereview. No
WP5G+, remote, PR, official conformance, release, publication, Tier, or Goal
action or claim is included.

### Final RFC 3986 rereview and WP5F acceptance

The final independent immutable rereview of evidence head
`806a1ca410af914768991773ebeb3ee3d1e9c121` reproduced every recorded
branch/head/tree identity; all six cumulative/evidence/remediation/RED/GREEN
binary diff hashes; all four immutable package hashes; diff-check; and clean
tracked status exactly. Post-verification identity and tracked status remained
unchanged.

The reviewer exercised 1,824 deterministic URI values through the real
automatic MRTR path against pinned `ajv-formats` 3.0.1 full mode: 1,131
oracle-valid and 693 oracle-invalid cases, with 0 acceptance/retry mismatches.
Every oracle-invalid value failed typed as `InvalidInputResponse`. The matrix
covered schemes and opaque paths, empty query/fragment cases, authorities,
userinfo, ports, IPv4-looking reg-names, IPv6/IPvFuture, percent encoding,
generic characters, relative references, and ASCII URI versus Unicode IRI.
The local runtime assertion, exact upstream attribution, preserved MIT notice,
and absence of a runtime `ajv-formats` dependency/import all passed review.

All nine earlier findings are resolved. Every one of the original ten
compliance groups passes, including generated handler validation, and the
special exact-map reconstruction focus passes without widening the generated
MRTR unions. Final result: specification compliance PASS, code quality and
security APPROVED, 0 Critical, 0 Important, 0 Minor, verdict `APPROVE`.
WP5F is accepted at code head
`19d9c3cdd4f6ae936dcecda9c1550681b58a53b1`.

Reviewer-owned Node `v22.22.3` evidence:

- `pnpm run test:wp5f-policy`: client 11/11, server 7/7, secure state 8/8,
  and both public type fixtures passed.
- `CI=true pnpm run test:wp5e`: cumulative accepted WP5A-WP5E passed.
- `CI=true pnpm run test:wp4-transports`: 12/12 passed.
- The first restricted `CI=true pnpm run verify` failed only because the two
  real loopback binds returned `EPERM`; it was not counted as product-green.
  The identical approved-loopback rerun exited 0, including all source/
  generated/invariant, WP2-WP5E, package/type/runtime, HTTP 116/116,
  integration, and both self-hosted draft E2E scenarios twice.
- 1,824-case automatic MRTR URI differential: 0 mismatches.
- Package dry run passed with the MIT notice included.
- `git diff --check`: pass; tracked status clean before and after commands.

Accepted immutable identity:

- Accepted code head/tree: `19d9c3cdd4f6ae936dcecda9c1550681b58a53b1` /
  `8b2191fa8efa3abc0194d09bccef5788caef7302`
- Reviewed evidence head/tree: `806a1ca410af914768991773ebeb3ee3d1e9c121` /
  `c167a4882238c72c7754e90f7354fa0641238fd8`
- Final package: `.superpowers/sdd/task-5f-rfc3986-rereview-package.md`
- Final package SHA-256:
  `e9aab3586b9f3bff165b69473425349e710a56cd5a4e8072b5b13d3eb98b4dd8`
- Cumulative code SHA-256 (`c4d4755..19d9c3c`):
  `1c7805eb5c08a99e4de226d5a293f39e9f64af80d8ce2108b353add153479148`
- Reviewed evidence SHA-256 (`c4d4755..806a1ca`):
  `ac5150d6000bfd9af2b85491581430de6961e852b48fa606739a31fa2bc3d413`
- Evidence-only SHA-256 (`19d9c3c..806a1ca`):
  `20b1d10e1cbebf7bb2a9e002c9311783b1aa74dd04a3d4115867eed8798e6f4f`

Acceptance is bounded to WP5F repository behavior. It is not official MCP
conformance, release readiness, publication, Tier completion, or Goal
completion. No remote, PR, release, WP5G+, Tier, or Goal-state action was taken
by this acceptance closeout; later work requires its own governed gates.

## Task 5G accepted

Task 5G replaces the transitional long-lived `subscriptionsListen` Effect with
a stable scoped `Subscription` product. The first immutable review rejected
the candidate with four Important findings. Those findings now have committed
RED witnesses and a focused GREEN remediation. A fresh immutable rereviewer
subsequently returned `APPROVE` with specification compliance PASS, code
quality PASS, and 0 Critical, 0 Important, and 0 Minor findings. The Goal
coordinator accepted this bounded work package without authorizing WP5H.

### Frozen boundary and original TDD history

- Preflight `1bac79e` freezes filter-only scoped acquisition, exact
  acknowledgement, the generated notification union, typed closure, bounded
  delivery, complete Cause handling, and request-owned transport teardown.
- Tests-only RED `d34dffc` produced 11 intended runtime failures, the expected
  missing public type diagnostics, and one declaration-export failure.
- Test corrections `b2ba679`, `abc75a0`, `1517270`, and `2912bcc` replace an
  impossible raw Effect Stream mixed-Cause assertion with exact embedded-Cause
  restoration, add first-winner/pure-interrupt/deep-DAG/opening/finalizer
  witnesses, and freeze exact runtime and declaration exports.
- Original GREEN `37ff971` adds the stable product, exact generated validation,
  serialized lifecycle, 16-notification-plus-terminal delivery, idempotent
  close-and-join, ordered dispatch, and HTTP/stdio teardown.

### First independent review and remediation

The frozen package `.superpowers/sdd/task-5g-review-package.md` had SHA-256
`874f1e8dd802767050276065bd55e1b969a0fb8b7199d423e8db2ca3f6ca9165`.
The reviewer reproduced its code head `37ff971`, evidence head `4fcb98e`,
trees, hashes, clean status, focused 18/18 runtime and 11/11 package gates, then
returned `CHANGES REQUIRED`: 0 Critical, 4 Important, 0 Minor.

1. A `null` filter was silently normalized to `{}` instead of failing exact
   generated-codec validation.
2. A hostile transport failure Proxy or hostile `.cause` value could defect
   settlement and leave `closed` hanging.
3. shared-Cause inspection could expand exponentially and raw DAG identity was
   not recovered after Effect Stream projected shared input structure.
4. overflow/protocol/dispatch detection could unwind into Stream finalization
   before claiming closure, allowing caller close to overwrite the earlier
   detected failure.

Committed tests-only RED `c4936f4` reproduced exactly those four failures:
21 runtime tests, 17 pass, 4 intended fail, exit 1. The failures observed null
acceptance, hostile settlement timing out, a shared raw DAG losing identity,
and detected overflow closing as `CallerClosed`.

GREEN `9f350e5` hardens the scoped lifecycle:

- `undefined` alone defaults the filter; `null` reaches exact validation.
- private WeakSet branding replaces unsafe external `instanceof` checks;
  hostile failure/cause inspection is contained and arbitrary `.cause` data is
  never interpreted as an Effect Cause without `Cause.isCause` recognition.
- Cause scanning is identity-memoized and transformation is iterative,
  stack-safe, and hash-consed so shared topology projected by Effect Stream is
  recovered without exponential work.
- detected owner failures claim and settle the serialized lifecycle before
  `processFrame` returns to Stream finalization; the deterministic overflow,
  protocol, and dispatch race proves caller close cannot overwrite them.

Focused GREEN witness `5e13fd1` documents the Cause tradeoff. Effect Stream
projects raw Cause structure before the client receives it, so equal leaf nodes
may be interned to recover bounded shared topology. The transformation does not
collapse `Sequential` or `Parallel` parents: a distinct repeated same-payload
input still returns a `Parallel` root with two semantic operand edges and both
defects preserved. Exact embedded typed Causes remain reference-identical.
The previous sub-250ms wall-clock assertion was removed; deterministic topology
assertions carry the regression, while a three-second outer timeout protects
only against hangs.

No generated output, dependency, lockfile, transport redesign, WP5H+, auth,
Tasks, Apps, remote, PR, official conformance, release, publication, Tier, or
Goal-state change is included.

### Replacement-candidate verification

Runtime: Node `v22.22.3`, pnpm `10.11.1`.

- `pnpm run test:wp5g`: runtime 22/22, public types, package runtime 11/11,
  exact declaration/type keys, packed consumer, and platform-free checks,
  exit 0.
- `CI=true pnpm run test:wp5f-policy`: accepted WP5F client 11/11, server 7/7,
  secure state 8/8, and both public type fixtures, exit 0.
- `pnpm run test:wp4-dispatcher`: 31/31 plus types, exit 0.
- `pnpm run test:wp4-stdio`: 22/22 plus types, exit 0.
- Approved-loopback `pnpm run test:wp4-http`: 116/116 plus all public type
  fixtures, exit 0.
- `pnpm run test:wp4-transports`: 12/12 plus types, exit 0.
- Approved-loopback exact `CI=true pnpm run verify`: exit 0. Source pins,
  Effect foundation/single-runtime, workflow, generated/invariants, build,
  frozen parity, WP3, WP4 including HTTP 116/116, cumulative WP5A-WP5E,
  package/public types, WP2, SDK/schema/runtime/extensions, source refresh,
  Tier operations, unit/integration, and both self-hosted draft E2E runs
  passed.
- `git diff --check 54e7af9..5e13fd1`: pass; tracked status clean before this
  replacement evidence update.

The readiness compiler remains truthful: official draft-targeted conformance,
release provenance/stability, published documentation, and agent evidence are
blocked or partial. Green repository health is not official MCP conformance,
release readiness, Tier completion, Goal completion, or WP5G acceptance.

### Replacement code identity before tracked evidence

- Accepted WP5F closeout base: `54e7af98d437183c40e0c910e7fbb73a8706aab6`
- Base tree: `b03538dedc6b458560b75317c1d20d70e1961fb3`
- Replacement WP5G code head:
  `5e13fd1ab4750f734d4ceaadce0905e0a1d60efe`
- Replacement code tree: `ad59c1a79e8b92405582b1f8cd3aabceccc85f41`
- Code binary diff SHA-256 (`54e7af9..5e13fd1`):
  `3cb27324df62548af2dc3799c145eb4b0001f03273cfc845639da138f2100746`
- Remediation binary diff SHA-256 (`4fcb98e..5e13fd1`):
  `385966c938db14f3a48a50f90846d42441101e45fba5bd139be1bdfb0d1bc65f`

### Fresh rereview and bounded acceptance

The fresh reviewer reproduced the base/code/evidence heads and trees, all four
binary diff hashes, both immutable package hashes, diff-check, branch, and
clean tracked status before and after review:

- Base head/tree: `54e7af98d437183c40e0c910e7fbb73a8706aab6` /
  `b03538dedc6b458560b75317c1d20d70e1961fb3`
- Accepted code head/tree: `5e13fd1ab4750f734d4ceaadce0905e0a1d60efe` /
  `ad59c1a79e8b92405582b1f8cd3aabceccc85f41`
- Reviewed evidence head/tree: `3138aa3b03abe6abb5a218c27b8e302c24dfb421` /
  `2919d23a2363aade382be24c805549b01f56c99a`
- Code/evidence/evidence-only/remediation SHA-256:
  `3cb27324df62548af2dc3799c145eb4b0001f03273cfc845639da138f2100746`,
  `cb0145e688bc62ec98ae485693a0bae971c4e2706fd8d5752465770af435ada0`,
  `7e149149242325d9089a6c340e3547f5f990ffc2408fe2f9daac49a1e7675872`,
  and `385966c938db14f3a48a50f90846d42441101e45fba5bd139be1bdfb0d1bc65f`
- Original/remediation package SHA-256:
  `874f1e8dd802767050276065bd55e1b969a0fb8b7199d423e8db2ca3f6ca9165`
  and `364d036830cb3bb7d4a36c32013cd619b3850a821b2254bfca74919153f39baa`

All four original Important findings were resolved. The reviewer also passed
all ten compliance groups and explicitly approved hostile-boundary totality,
Cause parent/order/multiplicity semantics under intentional leaf interning,
and settlement inside `processFrame` before Stream finalization.

Reviewer-owned fresh gates on Node `v22.22.3` and pnpm `10.11.1`:

- `pnpm run test:wp5g`: runtime 22/22, public types, package 11/11,
  packed consumer, exact exports, and platform-free checks passed.
- `CI=true pnpm run test:wp5f-policy`: client 11/11, server 7/7, secure state
  8/8, and both type fixtures passed.
- `CI=true pnpm run test:wp4-dispatcher`: 31/31 plus type fixture passed.
- `CI=true pnpm run test:wp4-stdio`: 22/22 plus type fixture passed.
- `CI=true pnpm run test:wp4-transports`: 12/12 passed.

The reviewer intentionally did not rerun HTTP or full verify and instead
validated their immutable evidence: approved-loopback HTTP 116/116 and exact
`CI=true pnpm run verify` exit 0, including both draft E2E runs. The reviewer
also did not run official conformance, client-auth qualification, Node 24
release gates, publication, Tier designation, later work, or Goal mutation.

Residual risk: Effect Stream can physically expand a highly shared raw Cause
before the client receives it. Client transformation is linear in the received
structure and preserves Cause semantics, parent order/multiplicity, and exact
embedded typed Cause identity, but leaf/subtree object identity is
intentionally not an exact raw-input promise.

Acceptance is bounded to WP5G repository behavior at code head `5e13fd1`.
It is not official MCP conformance, client-auth qualification, release
readiness, publication, Tier completion, or Goal completion. No remote, PR,
release, generated/dependency/lockfile change, WP5H work, or Goal-state action
is included in this closeout.

## Task 5H accepted: deprecated boundary, examples, and cumulative governance

Status: bounded repository-behavior acceptance at code head
`75cc7b217497cac381ab6d6f24581b2e010fe897`; release, Tier, and Goal gates
remain blocked.

### Delivered behavior

- `mcp-effect-sdk/deprecated` now exposes exactly the marked migration hooks
  `RootsProvider`, `SamplingHandler`, and `sendLoggingMessage`.
  `ElicitationHandler` and its obsolete source module are removed. Stable
  Elicitation remains exclusively under the client input-required policy and
  server `requestInput`; URL handling remains deny-by-default without an
  explicit policy handler. DCR remains untouched for WP6.
- Roots and Sampling compatibility comments explicitly deny standalone
  server-request routing. The stable root, client, server, and revisioned
  protocol entrypoints do not leak deprecated values.
- All four active examples use only source owners for published package
  entrypoints. Library examples load in-process, while executable Everything
  examples remain subprocess-only. The core catalog demonstrates stable form
  Elicitation/MRTR and preserves the scoped Subscription product. Task-heavy
  examples remain excluded for WP7.
- Ten direct focused `test:wp5-*` aliases cover the accepted WP5A-WP5H runtime,
  type, package, example, and governance suites without recursively replaying
  older cumulative aliases. `test:wp5-core` invokes each focused alias exactly
  once and `verify` owns that authoritative cumulative gate.
- The final public type fixture and an actual packed-tarball consumer prove the
  modern root/client/server/protocol/http/stdio/deprecated surface, exact
  deprecated keys, only declared dependency/peer installation, one Effect
  runtime, and sealed deep package paths.
- The parity ledger records WP5 as `implemented-locally` with exact evidence
  and approval/qualification boundaries while WP6-WP11 remain deferred.
  Migration, scenario, Tier, runtime, and readiness accounting distinguish
  local implementation for #13/#14/#17/#19 from deferred #15/#20 and retain
  every official conformance, release, documentation, agent-evidence, Tier,
  issue-disposition, and Goal blocker.

No generated output, dependency, lockfile, transport redesign, authorization,
Tasks, Apps, remote issue/PR, release, publication, Tier, or Goal-state change
is included.

### Exact commits and TDD evidence

The WP5H code range is `59ae86e..20a05b1`:

1. `0e5d1c2f881a9b82251ca036b094560387d84f31` — freeze the WP5H governance contract.
2. `4f2d54d4bf3fe47201139009cc59e32cdee27965` — committed tests-only public/governance RED.
3. `2dc740b548746d29b868c30dda1480e02ebad844` — finalize the exact deprecated boundary.
4. `f57792e3292778246c4fb887dea2add88252fcc2` — route examples through published entrypoints and correct accounting.
5. `20a05b13a7f0b1a1502867510b992d4bbc7458f5` — make direct WP5 aliases and the cumulative gate authoritative.

At committed RED `4f2d54d` on Node `v22.22.3` and pnpm `10.11.1`:

- The direct WP5H runtime/governance set had 13 tests: 3 passed and 10
  intended failures. Failures covered obsolete deprecated exports/source,
  unpublished example imports and absent catalog Elicitation, missing direct
  aliases/cumulative verify ownership, stale ledger/docs, and the packed exact
  deprecated-key boundary.
- The consolidated public type fixture produced exactly two intended errors:
  the missing-export expectation was unused because deprecated Elicitation
  still resolved, and the exact absence assertion observed `true`.
- The real tarball consumer already proved its isolated install mechanics,
  declared dependency set (`@effect/platform`, `ajv`, `effect`), public
  subpath imports, deep-path sealing, and one Effect runtime before stopping
  at the intended exact deprecated-key failure.
- Accepted `test:wp5e`, `test:wp5f-policy`, and `test:wp5g` baselines remained
  green; the RED did not weaken earlier work packages.

### Implementer verification

Both supported CI release lanes used Corepack/pnpm `10.11.1` and the exact
frozen strict-peer install. The first restricted Node 22 install attempt hit
registry `ENOTFOUND`, was stopped, and was not counted; the approved-network
rerun passed. The lockfile remained unchanged.

Node `v22.22.3`:

- `CI=true pnpm install --frozen-lockfile --strict-peer-dependencies`: exit 0.
- `CI=true pnpm run test:wp5-core`: exit 0. All ten focused aliases passed;
  representative exact totals include results 66/66, construction 57/57,
  JSON Schema/tool output 73/73, progress/cancellation 45/45,
  input-required/state 26/26, subscriptions 22/22, deprecated 3/3, examples
  4/4, and package/governance/tarball 17/17. All public type fixtures passed.
- Approved-loopback `CI=true pnpm run verify`: exit 0. HTTP passed 116/116;
  every WP2-WP5/package/type/generated/runtime/readiness gate passed; and
  `draft-round-trip` plus `tools-call` each passed twice.

Node `v24.15.0`:

- `CI=true pnpm install --frozen-lockfile --strict-peer-dependencies`: exit 0,
  already up to date. Node reported one tooling-side `url.parse()` deprecation
  warning; no product gate failed.
- `CI=true pnpm run test:wp5-core`: exit 0 with the same ten direct aliases,
  public types, exact package boundary, and real tarball consumer green.
- Approved-loopback `CI=true pnpm run verify`: exit 0. HTTP passed 116/116;
  all repository gates passed; and both draft E2E scenarios passed twice.

In both lanes the readiness compiler reported repository health `pass` while
MCP Tier 1, artifact-goal done, and release-ready remained blocked. This is
local package evidence only, not official MCP conformance, client-auth or
authorization qualification, release readiness, issue closure, Tier evidence,
WP5H acceptance, or Goal completion.

### Candidate identity before tracked evidence

- Accepted WP5G closeout base/tree:
  `59ae86e3033fcc65abcb7280d2a6ddd5cb46a17f` /
  `ea39672f50805a7e0c12c15479d9a14b5d32cd40`
- WP5H code candidate/tree:
  `20a05b13a7f0b1a1502867510b992d4bbc7458f5` /
  `ffb58dcd99ba061ed85548cdd1d8cd203632a040`
- Code binary diff SHA-256 (`59ae86e..20a05b1`):
  `f0aa726e4247374bc965f2f3c4f115dd4afec267b003d07573f9be7afe506aa3`
- `git diff --check 59ae86e..20a05b1`: pass; tracked status clean before
  this candidate-evidence update.

### First independent review and remediation

The frozen package `.superpowers/sdd/task-5h-review-package.md` had SHA-256
`ff669fa87399765401dd0bee79255d301153b0fe40a2d583741a3070757d2a71`.
The reviewer reproduced every base/code/evidence head, tree, binary hash,
package hash, diff-check, clean status, and dependency/lock/generated/auth/
transport/Tasks/Apps exclusion before returning `CHANGES REQUIRED`: 0
Critical, 2 Important, 1 Minor.

1. Readiness validation iterated only present issue-map entries. Truncated and
   duplicate maps passed, and an unknown issue without a status compared
   `undefined` to `undefined` and passed.
2. Three active examples imported `McpSchema` from root instead of the frozen
   revisioned protocol owner. The entrypoint allowlist did not enforce named
   namespace ownership.
3. The example import regex did not inspect dynamic import, CommonJS require/
   require.resolve, import-equals, export, or import-type module specifiers.

Tests-only RED `7be563a` added exact issue-map adversaries, named protocol/root
owner assertions, and TypeScript-AST traversal with synthetic coverage of all
supported module-specifier forms. On Node `v22.22.3`:

- Readiness self-test exited 1 and reported all three adversarial maps as
  incorrectly `pass`: truncated, duplicate, and unknown.
- Example tests had 6 cases: 5 passed and the ownership witness failed with
  all three root-routed `McpSchema` imports. The new AST traversal witness
  passed.

Routing generated `McpSchema` through the revisioned owner exposed that its
resource-template schema intentionally lacks the facade-only `param` helper.
Tests-only RED `0122164` therefore froze a narrow modern server owner with
exact runtime, declaration, consolidated public-type, WP5B packed-consumer,
and real-tarball proof:

- The public type fixture exited 2 because `Server.param` was absent.
- The package set had 12 tests: 9 passed and 3 intended failures covered exact
  server keys, the packed subpath, and the actual tarball runtime.

GREEN `e360468` resolves every finding and the surfaced public-owner gap:

- issue maps require exactly one of each known #13/#14/#15/#17/#19/#20 entry,
  exact statuses, non-empty areas, and no unknowns or length drift;
- all generated protocol namespaces route through
  `./protocol/2026-07-28`, while root imports are limited to existing OAuth
  namespaces;
- example source traversal uses the TypeScript AST for static, dynamic,
  CommonJS, export, import-equals, and import-type edges;
- the resource-template `param` helper is narrowly re-exported by `./server`,
  used by active examples, and frozen by exact runtime/declaration/type and
  real-tarball consumers. No additional facade type is exported.

### Replacement-candidate verification

Node `v22.22.3`, pnpm `10.11.1`:

- `CI=true pnpm run test:wp5-core`: exit 0; all ten focused aliases passed,
  including examples 6/6 and package/governance/tarball 17/17.
- Readiness self-test: 27/27; the three exact-map adversaries fail closed.
- Approved-loopback `CI=true pnpm run verify`: exit 0; HTTP 116/116, all
  source/generated/invariant/WP2-WP5/package/type/runtime/readiness gates,
  and `draft-round-trip` plus `tools-call` twice passed.

Node `v24.15.0`, pnpm `10.11.1`:

- `CI=true pnpm run test:wp5-core`: exit 0 with the strengthened example,
  public-type, exact server surface, and real-tarball proofs.
- Approved-loopback `CI=true pnpm run verify`: exit 0; HTTP 116/116, all
  repository gates, and both self-hosted draft E2E scenarios twice passed.

Both readiness runs preserved repository health `pass` and blocked MCP Tier 1,
artifact-goal done, and release-ready. The replacement remains local package
evidence only and awaits fresh immutable rereview; it is not official
conformance, authorization/client-auth qualification, issue closure, release,
Tier, WP5H acceptance, or Goal completion.

Replacement identity before tracked rereview evidence:

- Replacement code head/tree:
  `e3604684c08b64600415f15a25ee0a71517afbb7` /
  `8e5d4eae415890483fc29acd5cbe8d6326ccc144`
- Replacement code binary diff SHA-256 (`59ae86e..e360468`):
  `095dfe442c8b52785f7ce8873b86cd5038e00bac3cf543721754373d43ad2596`
- Remediation binary diff SHA-256 (`f68dc32..e360468`):
  `1d5c47eb9ac6498654d105217b03004c79969fb6bb86ac53c21182d819e4109f`
- `git diff --check 59ae86e..e360468`: pass; dependency fields, lockfile,
  generated output, auth/DCR, transports, Tasks, and Apps remain unchanged.

### Second independent rereview and final remediation

The frozen replacement package
`.superpowers/sdd/task-5h-rereview-package.md` had SHA-256
`99e3e79a2d71a6092eb563cf94f883a3857dde2470e910038eff64b977bd5a0d`.
A fresh reviewer reproduced its identities, hashes, clean status, scope
exclusions, and focused Node 22 gates before returning `CHANGES REQUIRED`: 0
Critical, 1 Important, 1 Minor.

1. **Important — root-owner traversal was incomplete.** The ownership guard
   inspected only static named imports and recorded local alias names rather
   than imported names. A named alias such as `{ McpSchema as OAuth }`, plus
   default, namespace, dynamic, require, require.resolve, import-equals,
   export, and import-type root access could bypass the root-owner rule.
2. **Minor — malformed readiness entries were not total.** An `issueMap`
   containing `null` threw a `TypeError` instead of returning a validation
   failure.

Tests-only RED `39388a3` froze both findings. On Node `v22.22.3`:

- readiness self-test exited 1 with the exact `TypeError` on a null issue-map
  entry;
- example tests had 7 cases: 6 passed and 1 intended failure reported all
  nine forbidden root forms as incorrectly accepted (named alias, default,
  namespace, dynamic import, require, require.resolve, import-equals, export,
  and import-type).

GREEN `c4201e2` makes the guards total without widening the public surface:

- named-import ownership is keyed by the imported symbol, not its local
  alias;
- the TypeScript-AST root traversal permits only static named imports of the
  existing `OAuth` and `OAuthProviders` namespaces and rejects every other
  root access form covered by the RED witness;
- readiness issue-map validation rejects null, primitive, and array entries
  as ordinary validation failures before reading their fields.

The focused Node 22 GREEN passed readiness self-test 27/27, build, examples
7/7, package/governance/tarball 17/17, tier protocol accounting, and the
truthfully blocked SDK readiness compilation.

### Final replacement verification

Node `v22.22.3`, pnpm `10.11.1`:

- `CI=true pnpm run test:wp5-core`: exit 0; all ten focused aliases passed,
  including results 66/66, construction 57/57, JSON Schema/tool output
  73/73, pagination/cache 44/44, progress/cancellation 45/45,
  input-required/state 26/26, subscriptions 22/22, deprecated 3/3, examples
  7/7, and package/governance/tarball 17/17;
- approved-loopback `CI=true pnpm run verify`: exit 0; all repository gates,
  HTTP 116/116, and `draft-round-trip` plus `tools-call` twice passed.

Node `v24.15.0`, pnpm `10.11.1`:

- `CI=true pnpm run test:wp5-core`: exit 0 with the same exact public,
  ownership, type, package, and tarball proofs;
- approved-loopback `CI=true pnpm run verify`: exit 0; all repository gates,
  HTTP 116/116, and both self-hosted draft E2E scenarios twice passed.

Both readiness runs preserved repository health `pass` and truthfully kept
MCP Tier 1, artifact-goal done, and release-ready blocked. This remains local
package evidence only and awaits a fresh immutable rereview; it is not
official conformance, authorization/client-auth qualification, issue closure,
release, Tier evidence, WP5H acceptance, or Goal completion.

Final replacement identity before tracked rereview evidence:

- Final replacement code head/tree:
  `c4201e2ec7770f0c90d1c7f08f4b63a04ec4b5b1` /
  `5af5a6027e4c8d532303328ecab018baf887aa4c`
- Final replacement code binary diff SHA-256 (`59ae86e..c4201e2`):
  `0f325e12e0e71a1b144f5c57fa608d29833eeb8ae57f0b94b06c9ec6bd8772f7`
- Third-remediation binary diff SHA-256 (`a676922..c4201e2`):
  `6fb56c06def51ccb4a9126f2666c26c5db79cfeaf62b65641ec026eba3e6579f`
- `git diff --check 59ae86e..c4201e2`: pass; dependency fields, lockfile,
  generated output, auth/DCR, transports, Tasks, and Apps remain unchanged.

### Final rereview and total-governance remediation

The frozen final package
`.superpowers/sdd/task-5h-final-rereview-package.md` had SHA-256
`9d16740c9ae585d8372bd6d3b5cc6e08375aacb709acabc4b150cec521c0cc69`.
A fresh reviewer reproduced every identity, hash, status, and scope exclusion
before returning `CHANGES REQUIRED`: 0 Critical, 2 Important, 0 Minor.

1. **Important — hostile issue-map entries still escaped.** Repeated direct
   field reads invoked own accessors and Proxy traps. A throwing getter and a
   Proxy `get` trap defected instead of returning an ordinary validation
   failure; value accessors could return inconsistent values across reads.
2. **Important — module ownership still recognized spellings, not the
   positive rule.** Parenthesized require, element-access require.resolve,
   module.require, aliased require, and computed dynamic import evaded both
   root ownership and generic deep-import traversal. A follow-up audit also
   identified call/apply wrappers and destructured aliases as enumerable
   variants that a callee allowlist could miss.

Tests-only RED `aa4f50a` froze the reviewer witnesses plus ordinary malformed
issue-map shapes. On Node `v22.22.3`:

- readiness self-test exited 1 after a value-returning own `issue` getter was
  invoked six times; witnesses also covered a throwing getter, Proxy get,
  ownKeys and getOwnPropertyDescriptor traps, a revoked Proxy, arrays, missing
  fields, empty area, and wrong status;
- example tests had 7 cases: 5 passed and 2 intended failures. The ownership
  witness listed all five reviewer loader variants as accepted, and generic
  traversal omitted their five matching deep paths.

GREEN `3ddde12` implements total positive governance:

- issue-map entries are rejected when they are proxies, arrays, accessors,
  missing/extra-key records, primitives, or null; exact own data descriptors
  are snapshotted under containment and only the snapshot is validated;
- getters and Proxy traps are never invoked by validation, including revoked
  Proxy handling before `Array.isArray`;
- all statically evaluable relative string expressions are inventoried via the
  TypeScript AST, including transparent expression wrappers, concatenation,
  and template expressions;
- `../index.js` is allowed only when it is exactly the module specifier of a
  static named import whose imported originals are `OAuth` or
  `OAuthProviders`; every other occurrence is rejected independently of
  loader callee spelling;
- synthetic coverage includes parenthesized/element/module/aliased require,
  computed dynamic import, require.call, Reflect.apply, and destructured
  aliases for both root and unpublished deep paths.

Focused Node 22 GREEN passed readiness self-test 27/27 with zero accessor
reads and all hostile cases returning validation failures, examples 7/7,
build, package/governance/tarball 17/17, tier protocol accounting, and
truthfully blocked SDK readiness.

### Post-totality dual-runtime verification

Node `v22.22.3`, pnpm `10.11.1`:

- `CI=true pnpm run test:wp5-core`: exit 0; exact totals remained results 66,
  construction 57, JSON Schema/tool output 73, pagination/cache 44,
  progress/cancellation 45, input-required/state 26, subscriptions 22,
  deprecated 3, examples 7, and package/governance/tarball 17;
- approved-loopback `CI=true pnpm run verify`: exit 0; all repository gates,
  HTTP 116/116, and `draft-round-trip` plus `tools-call` twice passed.

Node `v24.15.0`, pnpm `10.11.1`:

- `CI=true pnpm run test:wp5-core`: exit 0 with the same exact totals and
  strengthened hostile/ownership proofs;
- approved-loopback `CI=true pnpm run verify`: exit 0; all repository gates,
  HTTP 116/116, and both self-hosted draft E2E scenarios twice passed.

Both lanes preserved repository health `pass` while MCP Tier 1,
artifact-goal done, and release-ready remained truthfully blocked. This is
still local package evidence awaiting another fresh immutable rereview, not
official conformance, authorization/client-auth qualification, issue closure,
release, Tier evidence, WP5H acceptance, or Goal completion.

Post-totality identity before tracked rereview evidence:

- Code head/tree: `3ddde123362e14fb1f755a061a76a753df541a3c` /
  `73c2c7b969effd5400f13388c8a62fb04171e918`
- Code binary diff SHA-256 (`59ae86e..3ddde12`):
  `6dfc0920f00cf16d05e8901f1a4cfe2a63753e663954cb4e7a2ca946f73cc510`
- Totality remediation SHA-256 (`90829c0..3ddde12`):
  `fdb90da510d94b4979396a02e149101bef372859c29d83b2cb65223b5f4b4790`
- `git diff --check 59ae86e..3ddde12`: pass; dependency fields, lockfile,
  generated output, auth/DCR, transports, Tasks, and Apps remain unchanged.

### Totality rereview and containment/normalization remediation

The totality package `.superpowers/sdd/task-5h-totality-rereview-package.md`
had SHA-256
`083a06b7179d7b2bd8955529ebb56c89f2119cb1b99beff38d7154b4a9769262`.
A new fresh reviewer reproduced every frozen identity and scope exclusion, ran
the focused Node 22 core gate, and returned `CHANGES REQUIRED`: 0 Critical, 2
Important, 0 Minor.

1. **Important — hostile containers and own-data values could still
   defect.** Completeness and issue-map containers were read directly, and an
   own-data Symbol, coercing object, or revoked Proxy in `issue`, `area`, or
   `implementationStatus` reached property lookup or diagnostic coercion.
2. **Important — semantically equivalent upward paths escaped
   inventory.** `./../index.js` and `./../McpServer.js`, including static and
   templated forms, resolve to governed modules but did not begin with `..`.

Tests-only RED `79f89ff` froze the complete boundary:

- artifact/completeness/issueMap accessors, completeness and array Proxies,
  array-slot accessors, revoked array Proxies, and Symbol/coercing/revoked
  field values must all return ordinary failures with no invocation;
- prefixed and dot-segment root/deep paths are tested across static, dynamic,
  concatenated, and templated expressions, while raw published spellings stay
  exact.

On Node `v22.22.3`, readiness self-test exited 1 after six forbidden hostile
container invocations. Example tests had 7 cases: 5 passed and 2 intended
failures; `./../index.js` and templated root access were accepted, while
`./../McpServer.js` and templated `./../McpSchema.js` were omitted from deep
inventory. Existing `../internal/../...` raw paths were already inventoried
and rejected.

GREEN `6118b0e` closes both findings:

- the artifact property, exact completeness record, exact dense six-slot
  tracking/issue arrays, and exact issue-map entries are snapshotted through
  own data descriptors under containment;
- proxies are rejected before any array operation; accessors, sparse/extra
  slots, wrong lengths, missing/extra record keys, and revoked proxies fail
  without invocation;
- `issue`, `area`, and `implementationStatus` must be primitive nonempty
  strings before Map keys, property lookup, status comparison, or diagnostic
  interpolation;
- upward-relative paths are classified through POSIX dot-segment
  normalization, but the public-entrypoint allowlist continues comparing the
  exact raw spelling; normalized root equivalents are rejected unless the raw
  spelling is exactly `../index.js` and the syntax/imported originals satisfy
  the OAuth/OAuthProviders rule.

Focused Node 22 GREEN passed readiness self-test 27/27 with container reads,
entry getter reads, and field coercions all exactly zero; examples 7/7;
build; package/governance/tarball 17/17; tier accounting; and truthfully
blocked SDK readiness.

### Post-containment dual-runtime verification

Node `v22.22.3`, pnpm `10.11.1`:

- `CI=true pnpm run test:wp5-core`: exit 0; exact totals remained 66, 57, 73,
  44, 45, 26, 22, 3, 7, and 17;
- approved-loopback `CI=true pnpm run verify`: exit 0; every repository gate,
  HTTP 116/116, and both draft E2E scenarios twice passed.

Node `v24.15.0`, pnpm `10.11.1`:

- `CI=true pnpm run test:wp5-core`: exit 0 with the same exact totals and
  strengthened containment/normalization witnesses;
- approved-loopback `CI=true pnpm run verify`: exit 0; every repository gate,
  HTTP 116/116, and both draft E2E scenarios twice passed.

Repository health remains `pass`; MCP Tier 1, artifact-goal done, and
release-ready remain truthfully blocked. This is local package evidence
awaiting fresh immutable rereview, not official conformance,
authorization/client-auth qualification, issue closure, release, Tier
evidence, WP5H acceptance, or Goal completion.

Post-containment identity before tracked rereview evidence:

- Code head/tree: `6118b0e6b43700fc6378368a6d15668c81fe3330` /
  `4c894d280ae7940c925152946cc267c4013fa6f5`
- Code binary diff SHA-256 (`59ae86e..6118b0e`):
  `a337aed0bc891425424629e08822fe8a9b5d589bff653290f5ea7671071769cc`
- Containment remediation SHA-256 (`8ceabd3..6118b0e`):
  `c6033a71c3d1349d94ff796e51c00f32ac0c8ca5e0a6758c57bdad84184d5c3d`
- `git diff --check 59ae86e..6118b0e`: pass; dependency fields, lockfile,
  generated output, auth/DCR, transports, Tasks, and Apps remain unchanged.

### Containment rereview and normalized-deep remediation

The containment package
`.superpowers/sdd/task-5h-containment-rereview-package.md` had SHA-256
`9e1722be8a91f77f6e7770ba09bc995e626ef15cf1ffc58b906a8f1ba2dda815`.
A fresh reviewer reproduced every frozen identity, range hash, status, and
scope exclusion, then returned `CHANGES REQUIRED`: 0 Critical, 1 Important,
0 Minor.

The remaining Important finding was a policy/application mismatch in the
example guard. Traversal correctly inventoried normalized upward paths, but
the violation loop still applied only to raw spellings beginning with `..`.
Consequently `./../McpServer.js` and `./x/../../McpSchema.js` escaped, while
the equivalent raw `../McpServer.js` was rejected. The existing witness proved
inventory rather than the required policy rejection.

Tests-only RED `3de6dc9` directly exercised
`exampleImportViolations()` with prefixed and nested static, dynamic, and
templated deep imports. It also froze the positive rule that exact raw
published entrypoints remain allowed, including the exact static named OAuth
root form. On Node `v22.22.3`, `test:wp5-examples` exited 1 with 7/8 tests
passing and all six escaped labels reported as accepted.

GREEN `4dacb68` makes the violation loop apply to every
`normalizedUpwardSpecifier`, while continuing to grant allowance only through
exact raw `publicSdkEntrypoints` membership. No production SDK, dependency,
lockfile, generated output, auth/DCR, transport, Tasks, or Apps file changed.

Focused Node 22 GREEN passed examples 8/8, package/governance/tarball 17/17,
and readiness self-test 27/27.

### Post-normalized-deep dual-runtime verification

Node `v22.22.3`, pnpm `10.11.1`:

- `CI=true pnpm run test:wp5-core`: exit 0; exact totals were 66, 57, 73,
  44, 45, 26, 22, 3, 8, and 17;
- approved-loopback `CI=true pnpm run verify`: exit 0; every repository gate,
  HTTP 116/116, and `draft-round-trip` plus `tools-call` twice passed.

Node `v24.15.0`, pnpm `10.11.1`:

- `CI=true pnpm run test:wp5-core`: exit 0 with the same exact totals;
- approved-loopback `CI=true pnpm run verify`: exit 0; every repository gate,
  HTTP 116/116, and both self-hosted draft E2E scenarios twice passed.

Repository health remains `pass`; MCP Tier 1, artifact-goal done, and
release-ready remain truthfully blocked by their declared conformance,
release, documentation, and agent-evaluation requirements. The restricted
Node 22 precursor reproduced only the expected loopback `EPERM`; it is not
counted as verification and the approved-loopback rerun passed.

This remains local package evidence awaiting fresh immutable rereview, not
official conformance, authorization/client-auth qualification, issue closure,
release, Tier evidence, WP5H acceptance, or Goal completion.

Post-normalized-deep identity before tracked rereview evidence:

- Code head/tree: `4dacb685fb628da0719aa44d9a3ae49a45103a50` /
  `8e29746b3625ad2f4a4ea2066862b138b55f3374`
- Code binary diff SHA-256 (`59ae86e..4dacb68`):
  `8511588290f1b96adf985a0fbaf1c539254f227eb604f1b777e7895355e27c92`
- Normalized-deep remediation SHA-256 (`8d793ef..4dacb68`):
  `266be3c38030c9f18e77e14f973c8a487607c6018731e44ff72a2a0f33f95b9b`
- `git diff --check 59ae86e..4dacb68`: pass; dependency fields, lockfile,
  generated output, auth/DCR, transports, Tasks, and Apps remain unchanged.

### Normalized-deep rereview and Node ESM URL remediation

The normalized-deep package
`.superpowers/sdd/task-5h-normalized-deep-rereview-package.md` had SHA-256
`1dd116af164dba28146ec6c6e1c256393b7a8c2bc9c41d924ca930996487a1bb`.
A distinct fresh reviewer reproduced every frozen identity, hash, status, and
scope exclusion, then returned `CHANGES REQUIRED`: 0 Critical, 1 Important,
0 Minor.

The remaining Important finding was a Node ESM file-URL equivalence gap.
POSIX normalization did not classify percent-encoded dot segments or raw
backslashes even though Node resolves those spellings upward. The exact guard
accepted encoded and mixed-dot unpublished modules plus an encoded-root OAuth
import; live Node probes resolved the deep forms to the public parent module.

Tests-only RED `0386f9f` directly froze 12 bypasses through
`exampleImportViolations()`: lowercase and mixed-case percent encoding,
mixed-dot encoding, and backslashes across static, dynamic, concatenated, and
templated forms, plus the non-exact encoded-root OAuth spelling. On Node
`v22.22.3`, `test:wp5-examples` exited 1 with 8/9 tests passing and every one
of the 12 labels reported as accepted.

GREEN `75cc7b2` classifies relative specifiers with Node `file:` URL
resolution against a fixed example-directory sentinel, then computes whether
the resolved URL leaves that directory. Exact raw `publicSdkEntrypoints`
membership remains the sole allowance; root ownership still permits only raw
`../index.js` as a static named OAuth/OAuthProviders import.

Focused Node 22 GREEN passed examples 9/9, package/governance/tarball 17/17,
and readiness self-test 27/27.

### Post-file-URL dual-runtime verification

Node `v22.22.3`, pnpm `10.11.1`:

- `CI=true pnpm run test:wp5-core`: exit 0; exact totals were 66, 57, 73,
  44, 45, 26, 22, 3, 9, and 17;
- approved-loopback `CI=true pnpm run verify`: exit 0; every repository gate,
  HTTP 116/116, and `draft-round-trip` plus `tools-call` twice passed.

Node `v24.15.0`, pnpm `10.11.1`:

- `CI=true pnpm run test:wp5-core`: exit 0 with the same exact totals;
- approved-loopback `CI=true pnpm run verify`: exit 0; every repository gate,
  HTTP 116/116, and both self-hosted draft E2E scenarios twice passed.

Repository health remains `pass`; MCP Tier 1, artifact-goal done, and
release-ready remain truthfully blocked. No production SDK, dependency,
lockfile, generated output, auth/DCR, transport, Tasks, or Apps file changed.
This remains local package evidence awaiting a new fresh immutable rereview,
not official conformance, authorization/client-auth qualification, issue
closure, release, Tier evidence, WP5H acceptance, or Goal completion.

Post-file-URL identity before tracked rereview evidence:

- Code head/tree: `75cc7b217497cac381ab6d6f24581b2e010fe897` /
  `223009ccb0bf529394bbd4e6aede3dd269aee6b4`
- Code binary diff SHA-256 (`59ae86e..75cc7b2`):
  `9f79db30d31327456972af82c4dbdb60ee7cfcf501ebd75a74bf3cc710e6e3a3`
- File-URL remediation SHA-256 (`3674997..75cc7b2`):
  `c33d1138dac25bb02523da6f5b67261e4cded6f5bae35528793650aed9d11eb6`
- `git diff --check 59ae86e..75cc7b2`: pass; dependency fields, lockfile,
  generated output, auth/DCR, transports, Tasks, and Apps remain unchanged.

### Fresh file-URL rereview and bounded acceptance

The frozen file-URL package
`.superpowers/sdd/task-5h-file-url-rereview-package.md` had SHA-256
`3cf12f751e33e686714c0a968019fa32454a034794c6a40cfb5b10bad887605b`.
A distinct fresh reviewer reproduced the accepted WP5G base, post-file-URL
code and evidence heads and trees, every frozen binary-diff and package hash,
clean tracked status, `git diff --check`, and the unchanged dependency,
lockfile, generated, auth/DCR, transport, Tasks, and Apps exclusions.

The reviewer returned `APPROVE`: 0 Critical, 0 Important, and 0 Minor
findings. Every original compliance group passed:

1. exact deprecated/public runtime and declaration boundary;
2. stable Elicitation ownership and deferred later-work isolation;
3. published-owner active examples and executable-example isolation;
4. direct focused aliases and single cumulative governance owner;
5. consolidated public types and actual isolated tarball consumer;
6. exact ledger/readiness truth without qualification overclaim;
7. compatibility guards with unchanged unrelated boundaries;
8. meaningful committed RED witnesses retained through GREEN;
9. supported Node 22/24 frozen dual-runtime evidence; and
10. bounded scope with every release, Tier, acceptance, and Goal distinction.

Fresh reviewer verification on Node `v22.22.3` passed examples 9/9,
package/governance/tarball 17/17, and readiness self-test 27/27. The reviewer
also ran the cumulative core gate on the ambient unsupported Node `v25.6.1`;
it exited 0 with exact totals `66/57/73/44/45/26/22/3/9/17`. That ambient
run is supplemental only and does not replace the frozen supported Node 22
and Node 24 evidence. A direct `file:../` probe was ruled out as a
relative-parent bypass. The reviewer intentionally did not rerun either full
supported-runtime verify lane and instead validated the immutable evidence:
both approved-loopback runs exited 0 with HTTP 116/116 and both self-hosted
draft E2E scenarios twice.

Residual risk remains bounded to future Node URL-resolution behavior and new
statically evaluable JavaScript/TypeScript syntax forms. The positive-rule
tests cover the currently supported syntax and Node 22/24 behavior; extending
the examples or supported runtime matrix requires extending those witnesses.

Acceptance is bounded to WP5H repository behavior at code head `75cc7b2`.
It is not official MCP conformance, authorization or client-auth
qualification, issue closure, release readiness, publication, Tier
completion, or Goal completion. No remote, PR, issue, release, generated,
dependency, lockfile, auth/DCR, transport, Tasks, Apps, WP6, or Goal-state
action is included in this closeout.
