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

Status: remediation candidate at
`23689b64e7b884d6c523992ea1df72ee8b2dcbe4`; exact Node 22 verification is
green after the first independent review returned `CHANGES REQUIRED` with
0 Critical, 5 Important, and 2 Minor findings. Fresh immutable rereview is
pending. This is not an acceptance, conformance, release, or Tier claim.

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
- Every Critical or Important finding requires committed RED/GREEN correction
  and immutable rereview before Task 5D acceptance.

## Next bounded task

Task 5E: request-owned progress and cancellation. Do not begin until WP5D has
fresh independent approval and coordinator acceptance. Freeze the request
context/client API, exact progress-token and terminal ownership semantics,
failure policy, RED witnesses, and explicit non-goals before production work.
