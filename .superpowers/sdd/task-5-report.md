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

## Next bounded task

Task 5C: JSON Schema output. Inventory the existing schema conversion paths and
generated authority, then define the exact public API, compatibility policy,
failure channel, draft/dialect behavior, dependency boundary, and committed
RED witnesses before implementation. Do not broaden into caching, progress,
MRTR, subscriptions, authorization, Tasks, Apps, release, or Tier claims.
