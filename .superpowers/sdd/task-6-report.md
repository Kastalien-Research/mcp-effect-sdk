# Task 6 execution report

## WP6A: authorization source provenance

Status: accepted after fresh independent immutable rereview. Acceptance is
bounded to source provenance/governance. WP6 authorization behavior has not
started.

### Frozen identities

| Role | Commit | Tree |
| --- | --- | --- |
| Accepted WP5H base | `21c6b4f7ebb93854f519a2a709a9d53e2dcf887d` | `9577ee96ff15a532cb5e31c873341a09fe243cff` |
| Approved WP6 preflight | `c5835a40f28c73431e143583a883c47895cb160a` | `37a3d3361f864f2062566d1174f7eb0fa91b70be` |
| Initial WP6A provenance candidate | `a8d6ef8966c2eb0db726a54412e35a85f3234245` | `8a03ad35ec6e4048943fcce368b4d553e8798602` |
| Committed remediation RED | `40a43a371df6828e34dfb6919f5489af050fb8c2` | `0b7eaf1635f0e49f0998f16096898fc8dcc671ef` |
| Accepted WP6A code candidate | `91c7d7c26b80666e9cde207482ef898184c6e143` | `6911f55849f21f8c9fcaf56fa0c7c41a971e96c1` |

Ordered commits:

1. `c5835a4` — `docs: freeze WP6 authorization preflight`
2. `a8d6ef8` — `sources: pin MCP draft authorization prose`
3. `40a43a3` — `test: reject relocated authorization authority`
4. `91c7d7c` — `fix: pin authorization authority locations`

### Immutable candidate hashes

All diff hashes were produced from exact
`git diff --binary --full-index --no-ext-diff --no-textconv <from>..<to>`
bytes.

- Original WP6A range `c5835a4..a8d6ef8`:
  `ee93d30c94c8e41620832179424b35f76067baa793badee5eb2fcabc4647babd`
- Original cumulative range `21c6b4f..a8d6ef8`:
  `f5f66f48b064888b10c448f75bf212fe0094b96722dcd035b63fb22bcf6f056f`
- Original candidate archive:
  `ba1e0949d2a2bb4fee22202f6f1068b32db1de89cfa00d9260fac41ac278b651`
- Full remediation range `a8d6ef8..91c7d7c`:
  `37a0268370be1dd24ca765befa8880d11b6b7f1754c2b278d1e345c401a9c4f2`
- GREEN-only range `40a43a3..91c7d7c`:
  `432bee96952eeceb2e6f90fbe7d0eb9e3dbc593b1c1e670451f87cd6914f3a48`
- Accepted WP6A range `c5835a4..91c7d7c`:
  `a44ed0fb907e6110bdf73783b82695e7a596f5d30b06894fa5788c02c04d5f1f`
- Accepted cumulative range `21c6b4f..91c7d7c`:
  `14c93102f7901409e02e6879e45039bfa8a2df5941843df18a441e58e844d628`
- Accepted candidate archive:
  `4ab789578cf8c40a96545a48d6472431ae8f8d81ac663d5aca94d7b355242311`

Original review package
`.superpowers/sdd/task-6a-review-package.md` had full-file SHA-256
`a2a9f87cd49fd7ac47a45b060b5e9eb4dfd9d5601ea36163ed4c1a19a5882986`.
Replacement package `.superpowers/sdd/task-6a-rereview-package.md` had
full-file SHA-256
`b2011211b429b3b57cd709793849572ce3b896d022ab7a32b343e86bb6a9df90`.

### Exact normative sources

All four files are from
`modelcontextprotocol/modelcontextprotocol@26897cc322f356487da89113451bd16b520b9288`.

| Upstream path | Vendored path | SHA-256 |
| --- | --- | --- |
| `docs/specification/draft/basic/authorization/index.mdx` | `sources/vendor/mcp-core/authorization/index.mdx` | `4e1e0b760e8c9ff7bc322502dccf4450cd626036648b8221f66eb4be371da3c3` |
| `docs/specification/draft/basic/authorization/authorization-server-discovery.mdx` | `sources/vendor/mcp-core/authorization/authorization-server-discovery.mdx` | `22e2841a5e561afa1bd246c9e3cac64392402b3cac19d33da1e5d0987ccb3df8` |
| `docs/specification/draft/basic/authorization/client-registration.mdx` | `sources/vendor/mcp-core/authorization/client-registration.mdx` | `462d87866544bef7ce44fcbd6fcbb615eb30708e635d4d33a72ea7ae49866c23` |
| `docs/specification/draft/basic/authorization/security-considerations.mdx` | `sources/vendor/mcp-core/authorization/security-considerations.mdx` | `592befe83fe38e7184fda6e18a4dfba9748ab50280ea31fe1ad64974065a1612` |

The first source check rejected a supplied 63-character discovery hash before
commit. A second exact fetch and independent coordinator verification corrected
the missing `d` to the 64-character digest above. The immutable WP1
`sources/audited-baseline.json` remained byte-for-byte unchanged; this is a
current manifest inventory expansion at the same audited core revision.

### Source-precedence and preflight corrections

The vendored overview is normative and corrected the initial PR-based reading
of response `iss`:

- metadata `authorization_response_iss_parameter_supported === true` plus
  absent `iss` rejects before token exchange;
- any present `iss` uses exact, unnormalized simple-string comparison to the
  recorded issuer;
- false/absent metadata plus absent `iss` proceeds.

The coordinator also resolved the WP6 API boundary for later work:

- remove root `OAuth`, `OAuthProviders`, and `OAuthErrors` with no shim; only
  `./auth/client` and `./auth/protected-resource` are authoritative;
- replace `authInfo` outright with token-free
  `verifiedAuthorizationPrincipal`, available only without a configured
  verifier and never as a verification bypass.

WP6A records these decisions only; it does not implement them.

### First independent review and meaningful remediation RED

The first immutable review returned specification/source quality review with
`REQUEST CHANGES`: 0 Critical / 1 Important / 0 Minor.

Important finding: required authorization entries in
`scripts/check-source-snapshots.mjs` pinned only `upstreamPath` and `sha256`.
A coordinated manifest `vendoredPath` edit and file relocation therefore
passed while preserving the same bytes.

Commit `40a43a3` added a source-governance-only witness that copied the complete
source workspace, changed the overview `vendoredPath` to
`sources/vendor/mcp-core/authorization/renamed-index.mdx`, renamed the file,
and required checker rejection.

Exact Node `v22.22.3` RED:

- exit 1;
- 5 tests, 4 pass, 1 intended failure;
- checker incorrectly returned exit 0 with
  `Source snapshot check passed (6 pinned sources)`;
- assertion failed with
  `required authorization authority relocation must fail`;
- all fixture/setup and existing tests passed.

The RED failed for the reviewed defect, not a syntax, dependency, process, or
fixture error.

### GREEN remediation

Commit `91c7d7c` requires exactly one match for every required authorization
authority's complete `upstreamPath`, `vendoredPath`, and `sha256` tuple.
Missing, duplicate, relocated, malformed-path, and malformed-hash tuples fail.
Non-object file entries also record a malformed-entry failure. The existing
generic safe-path, every-vendored-byte, unrecorded-file, immutable-baseline,
license, refresh, conformance-package, and literal-spec-version checks remain.

The manifest, all four vendored files, and immutable baseline have no diff in
`a8d6ef8..91c7d7c`. Only the checker, source-provenance wording, and source
refresh integration test changed during remediation.

### Fresh accepted verification

Node `v22.22.3`:

- `node scripts/check-source-snapshots.mjs`: exit 0,
  `Source snapshot check passed (6 pinned sources)`;
- `node --test test/source-refresh.integration.test.mjs`: exit 0, 5 tests,
  5 pass, 0 fail, 0 skipped/cancelled/todo.

Node `v24.15.0`:

- `node scripts/check-source-snapshots.mjs`: exit 0,
  `Source snapshot check passed (6 pinned sources)`;
- `node --test test/source-refresh.integration.test.mjs`: exit 0, 5 tests,
  5 pass, 0 fail, 0 skipped/cancelled/todo.

Fresh exact-byte checks reproduced all four hashes above. Diff checks for
`a8d6ef8..91c7d7c` and `c5835a4..91c7d7c` exited 0 with no output. Tracked
status was clean. No full package build/verify was run because WP6A changes only
dependency-free source governance; no package/runtime source or dependency
changed.

### Fresh independent rereview and acceptance

A different fresh reviewer reproduced the immutable candidate and returned:

- specification compliance: `PASS`;
- source/provenance quality: `PASS`;
- original Important finding: resolved;
- findings: 0 Critical / 0 Important / 1 Minor;
- final verdict: `APPROVE`.

The accepted Minor residual is deliberately not changed in this closeout:

- A `null` manifest file entry fails closed with exit 1, but the earlier
  `recordedFiles` collection later dereferences the null entry and emits a
  `TypeError` in addition to the ordinary malformed-entry diagnostic.
- This is diagnostic quality only: the malformed manifest is rejected and
  cannot pass provenance validation.
- Any later repair requires its own authorization and RED-backed change; WP6A
  acceptance does not imply the diagnostic is ideal.

### Acceptance boundary

WP6A acceptance proves only that the four pinned authorization prose files are
recorded and checked network-free as exact unique source-authority tuples, with
truthful provenance and source precedence.

It does **not** prove or claim:

- OAuth client or protected-resource behavior;
- public auth exports, transport integration, examples, or client-auth zero
  failures;
- protected-resource integration with a real external authorization server;
- official MCP conformance, release readiness, publication, or Tier status;
- WP6 completion, WP7+ work, issue/PR disposition, release/tag/npm action, or
  Goal completion.

No secrets, credentials, `.env`, external authorization target, remote, issue,
PR, release, WP7+, or Goal state were read or mutated by WP6A acceptance.
WP6B may begin only under a separate coordinator authorization after this
closeout is reviewed.

## WP6B candidate evidence: public Effect authorization boundaries

### Candidate boundary

WP6B was implemented from accepted WP6A base
`8541cf9773292c5337f5f9b4b7146e6c48f3827c` / tree
`32e88bedcd8bc6ed4edbcd8a14f04d34a767ed16`. The candidate adds only the
two final package subpaths, shared schema-decoded value models, secret-safe
closed errors, Effect-native service ports/accessors, and their bounded tests.
It adds no live/default Layer, OAuth behavior, discovery, registration, token
exchange, bearer extraction, transport integration, dependency, lockfile,
example, generated output, or root authorization re-export.

The preflight/RED chain was `3614e3e`, `d1b5efd`, `c90875b`, and `48d9aac`.
The initial GREEN chain was `6844066`, `f40f47e`, `0cf9069`, `535624f`,
`58bc8cc`, and `6c22f98`.

One frozen-contract contradiction was found during the first cumulative run:
the required two package exports necessarily made the older WP5 exact export
list fail. Coordinator-approved amendment `fd2a185` authorized only extending
that list from eight to ten; `60ac18c` added only `./auth/client` and
`./auth/protected-resource` while preserving exact full-list equality and all
other package, graph, root, runtime, type, tarball, and deep-seal assertions.

An additional hostile-claims RED, `3eaf6b7`, proved that a revoked Proxy could
escape decoding as a throw and a time-varying Proxy could return a different
value after descriptor validation. Fix `13eb331` replaced the predicate-then-
copy path with one descriptor-based recursive snapshot. It never invokes
getters, copies accepted data descriptor values into fresh frozen arrays and
null-prototype objects, rejects non-JSON structures, catches reflection traps
as an ordinary schema failure, and does not re-read a Proxy after validation.

### Fresh verification

Node `v22.22.3`, pnpm `10.11.1`:

- `CI=true pnpm run build`: exit 0;
- client boundary: exit 0, 7/7;
- protected-resource boundary: exit 0, 7/7;
- strict ES2022 public type fixture: exit 0;
- auth packed-subpath suite: exit 0, 4/4;
- `CI=true pnpm run test:wp5-package`: exit 0, 17/17;
- `CI=true pnpm run test:wp5-core`: exit 0, all ten focused aliases;
- `CI=true pnpm run test:wp4-http`: exit 0, 116/116 plus all three public
  type fixtures;
- `CI=true pnpm run verify`: exit 0, including self-hosted draft e2e.

The first sandboxed HTTP run was 114/116 because the sandbox denied the only
two real ephemeral loopback listeners with `listen EPERM` on `127.0.0.1`.
The unchanged authoritative command passed 116/116 with bounded loopback
permission. This is recorded as an environment limitation, not a code pass
from retrying a behavioral failure.

Node `v24.15.0`, pnpm `10.11.1`:

- build: exit 0;
- combined client/protected-resource/auth-package suite: exit 0, 18/18;
- strict ES2022 public type fixture: exit 0;
- WP5 core: exit 0, all ten focused aliases;
- WP4 HTTP: exit 0, 116/116 plus all three public type fixtures;
- full verify: exit 0, including self-hosted draft e2e.

No standalone `conformance:client-auth` or
`conformance:authorization` command was run: WP6B provides no authorization
behavior or protected-resource HTTP integration, and no approved external
authorization target exists.

### Candidate-only conclusion and retained blockers

This evidence supports a WP6B **candidate for fresh independent review only**.
It is not WP6B acceptance and does not establish OAuth behavior, external
authorization-server qualification, official MCP conformance, issue closure,
release readiness, Tier status, WP6 completion, or Goal completion.

Full verification continues to account for the existing readiness blockers:
missing draft-targeted official conformance evidence, missing release
provenance and stable release, partial published documentation/dependency
policy evidence, and missing agent-salience/golden-transcript/affordance-
observability artifacts. No remote, issue, PR, release, publication, tag,
secret, credential, `.env`, WP6C+, WP7+, Tier, or Goal state was mutated.

## WP6B independent-review repair candidate

### Rejected candidate and committed RED

Fresh independent review of evidence candidate `969d201` returned
`REQUEST CHANGES`: 0 Critical / 4 Important / 0 Minor. The findings were:

1. optional protocol/verifier issuer and resource diagnostics admitted query
   and fragment content and constructors retained those invalid values;
2. decode-error issue strings were length-only and could retain arbitrary
   rejected input;
3. challenge error descriptions admitted CR, LF, and control characters;
4. principal `subject` incorrectly narrowed the frozen `Schema.String`
   contract to `Schema.NonEmptyString`.

Commit `882a3bf5908d111c12921dcc8d5df002ed9b71a6` / tree
`a4b5258b59c84691d1cb5c6224cf3c10141c7369` added only adversarial
regressions and corrected the historical empty-subject assertion. Exact Node
`v22.22.3` RED:

- client boundary: exit 1, 10 tests, 7 pass / 3 intended failures;
- protected-resource boundary: exit 1, 8 tests, 6 pass / 2 intended failures.

The failures corresponded exactly to the four review findings. All preexisting
tests passed, including the hostile principal-claims snapshot witness.

### Minimal GREEN

Commit `f6be9b5a3cdb380e13243c6abeea40d918715c92` / tree
`800dab5ce1a9206b0f9af91af0c6600c2cc9b6e5`:

- makes sanitized diagnostic identifiers reject userinfo, query, and fragment;
- snapshots optional issuer/resource own data descriptors and drops invalid or
  trap-bearing diagnostics before constructing either public error;
- replaces arbitrary issue strings with a closed literal union covering every
  encoded and public field of the five decode models plus numeric indices from
  zero through `0xfffffffe`;
- uses that same issue-segment predicate for schema decoding and constructor
  snapshotting, limits both dimensions to 16, copies only exact dense array
  data descriptors, and drops malformed paths without invoking accessors or
  re-reading hostile inputs;
- rejects C0, DEL, and C1 control characters from bounded challenge error
  descriptions.

Commit `09123fb4168402200adc9725b89d61e725789726` / tree
`eae1759b90641b0e482f1a856680dc2ce8b69c9e` restores the exact principal
contract by changing only `subject: Schema.NonEmptyString` to
`subject: Schema.String`.

No runtime/declaration export key, Context tag, service signature, Effect
channel, package export, dependency, lockfile, root, transport, example,
generated output, readiness checker, or conformance runner changed.

### Fresh repair verification

Node `v22.22.3`, pnpm `10.11.1`:

- build: exit 0;
- client boundary: 10/10;
- protected-resource boundary: 8/8;
- auth packed-subpath suite: 4/4;
- combined focused auth suite: 22/22;
- strict ES2022 public type fixture: exit 0;
- WP5 core: exit 0, all ten focused aliases;
- WP4 HTTP: exit 0, 116/116 plus all three public type fixtures;
- full verify: exit 0, including self-hosted draft e2e.

Node `v24.15.0`, pnpm `10.11.1`:

- build: exit 0;
- combined focused auth suite: 22/22;
- strict ES2022 public type fixture: exit 0;
- WP5 core: exit 0, all ten focused aliases;
- WP4 HTTP: exit 0, 116/116 plus all three public type fixtures;
- full verify: exit 0, including self-hosted draft e2e.

The HTTP/full gates used bounded loopback permission for their real ephemeral
listeners. No standalone authorization conformance command was run for this
boundary-only package.

### Repair-candidate boundary

This section records a **rereview candidate only**. The prior four-Important
verdict remains the last independent review until a fresh reviewer reproduces
the new immutable package and returns a verdict. This is not WP6B acceptance,
WP6 completion, official conformance, external authorization-server
qualification, release readiness, Tier status, or Goal completion.

The existing official-conformance, release-provenance/stable-release,
published-documentation, and agent-evidence blockers remain unchanged. No
remote, issue, PR, release, publication, tag, secret, credential, `.env`,
WP6C+, WP7+, Tier, or Goal state was mutated during repair.

## WP6B second independent-review repair candidate

### Rejected repair candidate and committed RED

Fresh independent rereview of evidence candidate
`d4c6109b50cac4dfb110f9d59e0c7de6e1ba3473` / tree
`11d284ff5e338d344160bd34689613926a489cd6` returned `REQUEST CHANGES`:
0 Critical / 3 Important / 0 Minor. The findings were:

1. the shared safe/sanitized URI predicate was unbounded and accepted
   malformed, control-bearing, and secret-bearing inspectable identifiers;
2. `AuthorizationScopeSet` decoding rebuilt its frozen transform output
   through an array target, leaving direct values and error scope fields
   mutable;
3. `AuthorizationDecodeError` reconstruction left both issue-array dimensions
   mutable after validation.

Commit `35de27468ce487575e1a15d3fb5cfbef09188f20` / tree
`7ce47b9f921b9029316b12555e74885ad6d320ce` added only the focused
regressions. Exact Node `v22.22.3` RED:

- client boundary: exit 1, 13 tests, 10 pass / 3 intended failures;
- protected-resource boundary: exit 1, 9 tests, 8 pass / 1 intended failure.

All 18 preexisting focused tests remained green. The failures corresponded
only to unsafe URI acceptance, mutable decoded/error scope sets, and mutable
decode-error issue paths.

### Minimal GREEN and adversarial amendment

Commit `0e3b0198228d0dd392184f8666742563a01e8e4d` / tree
`de25f1ca64d9625a759e849ef4c30abc264da3c7`:

- replaces the regex-only URI check with a dependency-free, platform-neutral
  parser bounded to 2048 code units;
- validates absolute schemes, DNS/IPv4/bracketed-IPv6 authorities and bounded
  numeric ports, RFC-safe path/query/fragment characters, and exact percent
  escapes;
- rejects raw or decoded C0/C1 controls, whitespace, backslashes, userinfo,
  malformed authority/host/port shapes, and secret-bearing components;
- preserves structurally safe fixed redirect-query routing while sanitized
  error diagnostics still reject all userinfo, query, and fragment content;
- changes the `AuthorizationScopeSet` transform target to an identity
  `Schema.declare` that accepts only its frozen transform output, avoiding the
  mutable array-target reconstruction while retaining source-schema encoding;
- freezes every reconstructed decode-error issue path and the outer issue
  array after `Schema.TaggedError` construction.

A follow-up adversarial audit found that the first parser used an arbitrary
three-pass normalization cap. Tests-only commit
`4988c57022bdd20123bb795ec49d1bcc12699f97` / tree
`06a48c8feb344a5776f67351c5e1f71c99853277` added a nested-escape
witness and an encoding witness for a frozen runtime-cast invalid scope set.
Exact Node `v22.22.3` RED was 13 tests, 12 pass / 1 intended failure: nested
encoding could bypass the three-pass limit. The frozen invalid scope encoding
already failed through the branded source schema as required.

Commit `6ecbb6bb721381f62e5a8ea909a03e58c47c6d76` / tree
`f1c48237667713cde1e6ab89efcb0a60a14eb859` removes that arbitrary cap
and normalizes encoded ASCII to stability under the existing 2048-character
input bound.

No runtime/declaration export key, Context tag, service signature, Effect
channel, package export, dependency, lockfile, root, transport, example,
generated output, readiness checker, or conformance runner changed.

### Fresh second-repair verification

Node `v22.22.3`, pnpm `10.11.1`:

- build: exit 0;
- combined client/protected-resource suite: 22/22;
- strict ES2022 public type fixture: exit 0;
- auth packed-subpath suite: 4/4, including exact exports, platform-neutral
  graphs, real tarball consumption, one Effect runtime, and sealed deep paths;
- WP5 core: exit 0, all ten focused aliases;
- WP4 HTTP: exit 0, 116/116 plus all three public type fixtures;
- full verify: exit 0, including self-hosted draft e2e.

The first sandboxed WP4 HTTP attempt was 114/116 because the sandbox denied
the suite's two real ephemeral loopback listeners. The unchanged command
passed 116/116 under bounded loopback permission; this was an environment
permission retry, not a behavioral-test retry.

Node `v24.15.0`, pnpm `10.11.1`:

- build: exit 0;
- combined client/protected-resource suite: 22/22;
- strict ES2022 public type fixture: exit 0;
- auth packed-subpath suite: 4/4;
- WP5 core: exit 0, all ten focused aliases;
- WP4 HTTP: exit 0, 116/116 plus all three public type fixtures;
- full verify: exit 0, including self-hosted draft e2e.

No standalone `conformance:client-auth` or `conformance:authorization`
command was run or claimed for this boundary-only package.

### Second-repair candidate boundary

This section records a new **rereview candidate only**. The three-Important
`REQUEST CHANGES` verdict remains the last independent verdict until a fresh
reviewer reproduces the new immutable package. It is not WP6B acceptance,
WP6 completion, official conformance, external authorization-server
qualification, release readiness, Tier status, or Goal completion.

Full verification continues to report the existing official-conformance,
maintenance/release-provenance and stable-release, published-documentation,
and agent-evidence blockers. No remote, issue, PR, release, publication, tag,
secret, credential, `.env`, WP6C+, WP7+, Tier, or Goal state was mutated.

## WP6B third independent-review repair candidate

### Rejected second-repair candidate and committed RED

Fresh independent rereview of evidence candidate
`8d6a391ded25f24baf5ae819383fd4ae8546b024` / tree
`16cc5aa6669299a94a98f2837b17aa2a4f3ebb46` returned `REQUEST CHANGES`:
0 Critical / 2 Important / 0 Minor. The findings were:

1. URI safety could still admit invalid UTF-8 percent encodings, encoded
   controls, and broader sensitive query, fragment, and component-name
   families;
2. public authorization arrays could still traverse hostile or mutable array
   structures before an owned dense snapshot was established.

Commit `23077f568a02a0a39980c819af735a40ab93b0dd` / tree
`a44c3f8533b248140a813644c8f36a3b4c9f0aec` added only focused runtime
regressions. Exact Node `v22.22.3` RED was 25 tests, 22 pass / 3 intended
failures: one URI-totality/classification failure, one client/common hostile
array matrix failure, and one principal/policy hostile array matrix failure.
All 22 prior focused tests remained green.

During the minimal implementation, a provisional helper widened the public
nonempty `authorizationServers` tuple type. Commit
`2474142b424d7d2ff3381ac24c4caea265380cae` / tree
`f7fed7ff0fadb50ce16b081cfd8936a081c6dbcb` added strict Type and Encoded
tuple witnesses. The provisional production state then failed exactly two
`TS2344` assertions before the helper was split into array and nonempty-array
forms.

### Minimal GREEN

Commit `be3ac565bea3b9e6cffae7a32a1d6f7134cebeff` / tree
`1ca023e7c2d5ef3074a5617603a371ae6361cb23`:

- repeatedly decodes URI percent escapes to stability and fails closed on
  malformed UTF-8, decoded controls, whitespace, and backslashes;
- classifies separator- and camel-delimited component names against complete
  sensitive credential families while preserving safe fixed redirect query
  routing;
- keeps sanitized diagnostic identifiers query- and fragment-free;
- introduces one descriptor-only dense ordinary-array snapshot boundary that
  catches array-brand, prototype, key, and descriptor traps, rejects holes,
  accessors, symbols, extra keys, and oversize inputs, and never reads an
  indexed value after its descriptor snapshot;
- applies that boundary before traversal at every public authorization array
  and nonempty-array schema, including metadata, principal audiences/scopes,
  and both decode-error issue dimensions;
- preserves readonly array and nonempty tuple Type/Encoded contracts, source
  schema encoding, nonempty and element validation, issue bounds, and frozen
  decoded outputs.

Only `src/auth/common.ts`, `src/auth/client/errors.ts`, and
`src/auth/protected-resource/models.ts` changed in production. No public
runtime/declaration export key, Context tag, service signature, Effect error
channel, package export, dependency, lockfile, root, transport, example,
generated output, readiness checker, or conformance runner changed.

### Fresh third-repair verification

Node `v22.22.3`, pnpm `10.11.1`:

- build: exit 0;
- client boundary: 15/15;
- protected-resource boundary: 10/10;
- strict ES2022 public auth type fixture: exit 0;
- auth packed-subpath suite: 4/4;
- WP5 core: exit 0, all ten focused aliases;
- WP4 HTTP: exit 0, 116/116 plus all three public type fixtures;
- full verify: exit 0, including self-hosted draft e2e.

Node `v24.15.0`, pnpm `10.11.1`:

- build: exit 0;
- client boundary: 15/15;
- protected-resource boundary: 10/10;
- strict ES2022 public auth type fixture: exit 0;
- auth packed-subpath suite: 4/4;
- WP5 core: exit 0, all ten focused aliases;
- WP4 HTTP: exit 0, 116/116 plus all three public type fixtures;
- full verify: exit 0, including self-hosted draft e2e.

The HTTP/full gates used bounded loopback permission for their real ephemeral
listeners. No standalone authorization conformance command or real external
authorization-server integration was run or claimed for this boundary-only
package.

### Third-repair candidate boundary

This section records a new **rereview candidate only**. The two-Important
`REQUEST CHANGES` verdict remains the last independent verdict until a fresh
reviewer reproduces the new immutable package. It is not WP6B acceptance,
WP6 completion, official conformance, external authorization-server
qualification, release readiness, Tier status, or Goal completion.

Full verification continues to report the existing official-conformance,
maintenance/release-provenance and stable-release, published-documentation,
and agent-evidence blockers. No remote, issue, PR, release, publication, tag,
secret, credential, `.env`, WP6C+, WP7+, Tier, or Goal state was mutated.

## WP6B fourth independent-review repair candidate

### Rejected third-repair candidate and committed RED

Fresh independent rereview of evidence candidate
`b8336b2f6d1dd910f6005fda0b6412fe03cba083` / tree
`1841eb92f34338a467c5154ab84c0d181c81c510` returned `REQUEST CHANGES`:
0 Critical / 2 Important / 0 Minor. The findings were:

1. fully decoded authorization identifiers could retain Unicode format/bidi
   characters, nested sensitive assignments, and private/signing/encryption
   key-family names;
2. direct `AuthorizationPrincipal` construction read top-level properties and
   spread audience/scope arrays before the safe schema boundaries, invoking
   accessors and permitting revoked, changing, or oversize traversal hazards.

Commit `f113942234a1eee2f5df1fcd992014a6a2dfd927` / tree
`042bc2b64d04d9a89362652253c10c711e084072` added only focused
regressions. Exact Node `v22.22.3` RED was 27 tests, 25 pass / 2 intended
failures. One failure aggregated Unicode C/Z, nested assignment, and key-family
URI cases; the other aggregated top-level property and constructor-array
hostility. All 25 prior focused tests remained green, as did safe fixed-route
query and valid complete/minimal principal construction witnesses.

### Minimal GREEN

Commit `70dee73096d4f1c394fd193d72dccab00227af2e` / tree
`c02270d984f5c40d9ede8d76c140da485d8f457f`:

- rejects Unicode category C and Z characters plus backslashes after repeated
  standards decoding to stability under the existing 2048-code-unit bound;
- scans every decoded assignment boundary globally and splits nested query and
  fragment delimiters, so nested encoded identifiers cannot hide a sensitive
  name;
- treats `key` and `keys` as sensitive component words, covering camel-,
  snake-, and dash-delimited private, signing, encryption, and API key names;
- retains safe fixed redirect routing queries and query/fragment-free
  diagnostic identifiers without adding Node, DOM, `URL`, `Promise`, or other
  platform imports;
- snapshots every known principal property once through caught own data
  descriptors, rejects accessors and reflection traps with a fixed non-secret
  failure, and never invokes top-level property getters;
- passes the raw audience, scope, and claim descriptor values through the
  existing descriptor-safe schemas before `Schema.Class` construction, so
  revoked, accessor, time-varying, and oversize arrays cannot be traversed by
  the custom constructor first;
- preserves empty subjects, exact optional omission/value behavior, frozen
  audience/scope/claim results, and the existing Type/Encoded contracts.

Only `src/auth/common.ts` and
`src/auth/protected-resource/models.ts` changed in production. No public
runtime/declaration export key, Context tag, service signature, Effect error
channel, package export, dependency, lockfile, root, transport, example,
generated output, readiness checker, or conformance runner changed.

### Fresh fourth-repair verification

Node `v22.22.3`, pnpm `10.11.1`:

- build: exit 0;
- combined client/protected-resource boundary: 27/27;
- strict ES2022 public auth type fixture: exit 0;
- auth packed-subpath suite: 4/4;
- WP5 core: exit 0, all ten focused aliases;
- WP4 HTTP: exit 0, 116/116 plus all three public type fixtures;
- full verify: exit 0, including self-hosted draft e2e.

Node `v24.15.0`, pnpm `10.11.1`:

- WP5 core: exit 0, all ten focused aliases;
- WP4 HTTP: exit 0, 116/116 plus all three public type fixtures;
- full verify: exit 0, including self-hosted draft e2e.

The HTTP/full gates used bounded loopback permission for their real ephemeral
listeners. No standalone authorization conformance command or real external
authorization-server integration was run or claimed for this boundary-only
package.

### Fourth-repair candidate boundary

This section records a new **rereview candidate only**. The two-Important
`REQUEST CHANGES` verdict remains the last independent verdict until a fresh
reviewer reproduces the new immutable package. It is not WP6B acceptance,
WP6 completion, official conformance, external authorization-server
qualification, release readiness, Tier status, or Goal completion.

Full verification continues to report the existing official-conformance,
maintenance/release-provenance and stable-release, published-documentation,
and agent-evidence blockers. No remote, issue, PR, release, publication, tag,
secret, credential, `.env`, WP6C+, WP7+, Tier, or Goal state was mutated.

## WP6B fifth independent-review repair candidate

### Rejected fourth-repair candidate and committed RED

Fresh independent rereview of evidence candidate
`9e16378eaba5ee40a115d2c0a04f69748be450d8` / tree
`b344cb607bcd6b37528925a08221f546a712c879` returned `REQUEST CHANGES`:
0 Critical / 2 Important / 0 Minor. The findings were:

1. public authorization URI schemas still admitted standalone decoded query
   names `private`, `signing`, and `encryption`, even though their compound
   key variants were rejected;
2. direct `AuthorizationPrincipal` validation failures retained hostile
   rejected own-data values in the underlying Effect Schema `ParseError`,
   exposing them through error rendering and property inspection.

Commit `51664115c77f216992e9aa820941cf98aa718bb6` / tree
`9c147021eb15d171f3521575b44b7638b86efd08` added only focused
regressions. Exact Node `v22.22.3` RED was 29 tests, 27 pass / 2 intended
failures. One failure covered standalone and plural private/signing/encryption
names through both public URI schemas while the camel-, snake-, and
dash-delimited key variants and `?route=one` controls remained green. The
other proved that an invalid client-ID object and a Symbol audience element
were retained by constructor `ParseError` forms and own-property traversal,
while a descriptor failure used a different `TypeError`. All 27 prior focused
tests remained green.

### Minimal GREEN

Commit `f055fb8494840430d63f0763259c0eae379bed24` / tree
`555360062faf5e217d7a618d9d803221a906075e`:

- adds standalone and plural private, signing, and encryption words to the
  existing sensitive component-name family, while retaining the existing
  delimiter/camel splitting, stable decoding, 2048-code-unit bound, safe
  fixed-route query, and platform-neutral implementation;
- places descriptor snapshot failure and every internal principal-property
  schema decode behind one constructor boundary;
- replaces every rejected direct-construction path with a fresh fixed
  `TypeError("AuthorizationPrincipal properties are invalid")` that has no
  cause, detail, input, issue, or retained underlying `ParseError`;
- retains descriptor-only access, valid complete/minimal construction, empty
  subjects, exact optional omission, frozen audience/scope/claim results,
  ordinary schema decode/encode behavior, and public types.

Only `src/auth/common.ts` and
`src/auth/protected-resource/models.ts` changed in production. No public
runtime/declaration export key, Context tag, service signature, Effect error
channel, package export, dependency, lockfile, root, transport, example,
generated output, readiness checker, or conformance runner changed.

### Fresh fifth-repair verification

Node `v22.22.3`, pnpm `10.11.1`:

- build: exit 0;
- combined client/protected-resource boundary: 29/29;
- strict ES2022 public auth type fixture: exit 0;
- auth packed-subpath suite: 4/4;
- WP5 core: exit 0, all ten focused aliases;
- WP4 HTTP: exit 0, 116/116 plus all three public type fixtures;
- full verify: exit 0, including self-hosted draft E2E.

Node `v24.15.0`, pnpm `10.11.1`:

- WP5 core: exit 0, all ten focused aliases;
- WP4 HTTP: exit 0, 116/116 plus all three public type fixtures;
- full verify: exit 0, including self-hosted draft E2E.

The first sandboxed Node 22 WP4 invocation passed 114/116 and failed only
because the sandbox denied its two real `127.0.0.1` listeners. The unchanged
command passed 116/116 under bounded loopback permission. Node 24 WP4 and both
full gates used the same bounded permission where real listeners were needed.

No standalone authorization conformance command or real external
authorization-server integration was run or claimed for this boundary-only
package.

### Fifth-repair candidate boundary

This section records a new **rereview candidate only**. The two-Important
`REQUEST CHANGES` verdict remains the last independent verdict until a fresh
reviewer reproduces the new immutable package. It is not WP6B acceptance,
WP6 completion, official conformance, external authorization-server
qualification, release readiness, Tier status, or Goal completion.

Full verification continues to report the existing official-conformance,
maintenance/release-provenance and stable-release, published-documentation,
and agent-evidence blockers. No remote, issue, PR, release, publication, tag,
secret, credential, `.env`, WP6C+, WP7+, Tier, or Goal state was mutated.

## WP6B sixth independent-review repair candidate

### Rejected fifth-repair candidate and committed RED

Fresh independent rereview of evidence candidate
`aff82e6976ceb952650c05c4eeb338eb9d8499bf` / tree
`df934d4c9ddc6a5bfc08eca638b6bd03c322370d` returned `REQUEST CHANGES`:
0 Critical / 2 Important / 0 Minor. The findings were:

1. the five constructors with reason-derived messages re-read
   `props.reason` after superclass validation, allowing a time-varying Proxy
   to place a second hostile value in the public message;
2. invalid known model, operation, or reason values across all eight public
   tagged-error constructors escaped as raw Effect Schema `ParseError`
   structures retaining rejected hostile input.

Commit `0cdc387c93c668bdf63dcb3a741cbea7f5f3c4a2` / tree
`2749631fb462b03eaf58093bfcd868dbf1646b9d` added only focused
regressions. Exact Node `v22.22.3` RED was 31 tests, 29 pass / 2 intended
failures. One aggregate failure covered reason accessors and time-varying
Proxy reads across crypto, interaction, store, protocol, and token
verification errors. The other covered repeated invalid discriminator data,
known-field accessors, revoked reflection, recursive error inspection, and
unknown-accessor controls across all eight public tagged errors. All 29 prior
focused tests remained green.

### Minimal GREEN

Commit `2bf7d4b7f70b888dd055575f6991c80f7013003a` / tree
`b663a875e4abcaed17bfd6873642ff4dfa1d3832`:

- extracts each class's field object and reuses it for both the public
  `Schema.TaggedError` and its constructor-only `Schema.Struct` decoder;
- snapshots exactly the known own data descriptors once into a fresh plain
  record, rejecting accessors and reflection failures without invoking them;
- decodes the snapshot behind one caught boundary and replaces every
  reflection or validation failure with a fresh
  `TypeError("Authorization error properties are invalid")`, retaining no
  underlying `ParseError`, cause, issue, input, or hostile value;
- builds all five reason-derived messages from the decoded local reason rather
  than from caller properties;
- preserves dropped invalid optional issuer/resource diagnostics, closed and
  frozen decode issue paths, valid frozen status/scope/policy fields, unknown
  extension omission, exact constructor types, schemas, keys, and messages.

Only `src/auth/client/errors.ts` and
`src/auth/protected-resource/errors.ts` changed in production. No public
runtime/declaration export key, Context tag, service signature, Effect error
channel, package export, dependency, lockfile, root, transport, example,
generated output, readiness checker, or conformance runner changed.

### Fresh sixth-repair verification

Node `v22.22.3`, pnpm `10.11.1`:

- build: exit 0;
- combined client/protected-resource boundary: 31/31;
- strict ES2022 public auth type fixture: exit 0;
- auth packed-subpath suite: 4/4;
- WP5 core: exit 0, all ten focused aliases;
- WP4 HTTP: exit 0, 116/116 plus all three public type fixtures;
- full verify: exit 0, including both self-hosted draft E2E executions.

Node `v24.15.0`, pnpm `10.11.1`:

- WP5 core: exit 0, all ten focused aliases;
- WP4 HTTP: exit 0, 116/116 plus all three public type fixtures;
- full verify: exit 0, including both self-hosted draft E2E executions.

The WP4 and full gates used bounded loopback permission for their real
ephemeral listeners. No standalone authorization conformance command or real
external authorization-server integration was run or claimed for this
boundary-only package.

### Sixth-repair candidate boundary

This section records a new **rereview candidate only**. The two-Important
`REQUEST CHANGES` verdict remains the last independent verdict until a fresh
reviewer reproduces the new immutable package. It is not WP6B acceptance,
WP6 completion, official conformance, external authorization-server
qualification, release readiness, Tier status, or Goal completion.

Full verification continues to report the existing official-conformance,
maintenance/release-provenance and stable-release, published-documentation,
and agent-evidence blockers. No remote, issue, PR, release, publication, tag,
secret, credential, `.env`, WP6C+, WP7+, Tier, or Goal state was mutated.

## WP6B independent acceptance closeout

A fresh independent reviewer reproduced the sixth repaired candidate
`41f790aab37bff489c08c44c761a68e6f231b4d6` / tree
`12278ba901be15bafa6fc3d82352d1a9700de4c7` from immutable rereview package
6, canonical payload SHA-256
`93764b8e746131a48b177edb6e2924ef3ce97ba31d34ed0a6d0e184802056699`
and full-file SHA-256
`9614f06e424d96082f7bb04f82bf8deb01576c2c76e6daadd10ef6d69afa8802`.

The exact independent verdict is **`APPROVE` — 0 Critical / 0 Important /
0 Minor**. This supersedes the prior sixth-repair input verdict of
`REQUEST CHANGES` — 0 Critical / 2 Important / 0 Minor. The approved evidence
includes the committed meaningful RED, minimal two-file GREEN, exact public
types and runtime surfaces, Node 22 focused/build/type/package results, the
Node 22 and Node 24 WP5/WP4/full verification matrix, immutable inventories,
and independently reproduced candidate, range, archive, file, and package
hashes recorded above and in package 6.

This approval accepts **WP6B's public Effect authorization boundaries only**:
the stable `mcp-effect-sdk/auth/client` and
`mcp-effect-sdk/auth/protected-resource` schemas, tagged errors, Context
services, Effect error channels, helper facades, sealed package subpaths, and
the documented local verification evidence.

The approval does **not** establish or claim OAuth discovery, dynamic client
registration, state or PKCE handling, authorization callbacks, token exchange
or refresh, audience enforcement, bearer extraction, transport integration,
a live authorization Layer, or behavior against an authorization server.
Official authorization and client-auth conformance remain unrun; no external
authorization-server integration was run. WP6C and later work, official MCP
qualification, issue disposition, release provenance or publication, stable
release, Tier status, and Goal completion remain unrun, blocked, deferred, or
approval-gated as previously recorded.

This closeout changes only the tracked WP6B evidence report. It does not edit
code, tests, package metadata, dependencies, generated output, conformance
runners, readiness state, release state, Tier state, or Goal state.

## WP6C candidate evidence: discovery, registration, and scope resolution

### Candidate boundary and immutable identities

WP6C starts from accepted WP6B closeout `662bddf34deaebc8f6ba66e793e361bb0be36659`
/ tree `f0e20a4136208861f69f5d020c18341eeebbca09`. It adds only package-private,
Effect-native authorization discovery, exact issuer selection, credential
registration, cumulative scope resolution, and their bounded tests. It does
not add or change any public export, live Layer, state/PKCE/callback/token
flow, transport integration, dependency, lockfile, example, root namespace,
generated artifact, conformance runner, readiness policy, or release surface.

| Role | Commit | Tree |
| --- | --- | --- |
| Accepted WP6B base | `662bddf34deaebc8f6ba66e793e361bb0be36659` | `f0e20a4136208861f69f5d020c18341eeebbca09` |
| Approved WP6C preflight | `194a0c0` | `2fcc91ce4b35ba1759afd8e18a2faac9978b4226` |
| Initial meaningful RED | `90b8584` | `75d7bb5d4da0a49eb959a772d3ef9e3ca0e1c6c4` |
| Typed-failure test correction | `1db7bf4` | `88bf7d552652df847ade29379a1d6e90ed09703f` |
| Production GREEN | `6bbfb9f` | `cb65e86785c5bd8d8da1dda33eadb0c2c5b3f9b3` |
| Verification-policy test correction | `b32f1b9` | `181eb08828202f562a4de26fcd4dee4c0c9b0703` |

The approved preflight has full-file SHA-256
`8e6e1daf82148a4e597bc51180da74d80e8ca89bc1f71678d11515805ab4d6cd`.
All diff hashes below are SHA-256 over exact
`git diff --binary --full-index --no-ext-diff --no-textconv` bytes:

- preflight to initial RED: `3de14631fc9304e8d46466055906c2b84938cd4318bf3babce6724836f73b081`;
- initial RED to typed-failure correction: `c05e86bc997fdbeddeb815ef6ad68f9a6d895335ee96d52876266a636148caa1`;
- corrected RED to production GREEN: `206ccefbf4d04fa04a1bebd4a4634dd6e50d16cd6959d5c71fedc4272b5558ab`;
- GREEN to verification-policy correction: `90ed09120c23bf0e820643ce39c60531f6fa2318dbbc3ac7baba6ae0c55c4b83`;
- complete WP6C range: `6eb1141daca196b7148862aafcca8c11d9e19f3b82a08028bdd2db8a7a784bef`;
- accepted-WP6B-base cumulative range: `03aaa7971692ee06b1bb4087a4642fa6afb6827ebe7beb1a4a21678ad90624b3`.

Candidate archive SHA-256 is
`453bc3ded3a4707398c4dc1110ad8629e45f39b566680734b6f451179aadd505`.
The base-to-candidate inventory is exactly one preflight, five production
modules under `src/auth/client/`, and four focused tests under `test/auth/`.

### Meaningful RED and implementation

The initial RED added 23 behavioral tests. With generated WP6C outputs absent,
all 23 failed solely because the five package-private modules did not exist;
the build and accepted WP6B boundary/package tests remained green. Commit
`1db7bf4` changed only observation of typed Effect failures to `Effect.either`
and added pre-network configuration/unsafe-endpoint witnesses; the corrected
RED was reproduced by temporarily removing only the five generated WP6C
module pairs from `dist/`, and again failed only on their absence.

Production commit `6bbfb9f` adds:

- strict URI/origin/path helpers with exact unnormalized issuer comparison;
- bounded total UTF-8 and JSON decoding without Web, DOM, Node, Promise, or
  platform globals;
- protected-resource and authorization-server discovery with exact candidate
  order and fallback only on HTTP 404;
- issuer selection by preregistration, stored credential, then document order;
- preregistered, stored, CIMD, DCR, then unsupported credential precedence,
  including exact DCR `application_type` handling and redacted secrets;
- stable prior/requested/challenge scope union with metadata fallback only
  when explicit sources are absent;
- package-private context composition and validation before port activity.

Commit `b32f1b9` removes duplicate assertions about the repository-owned
development RPC peer from the WP6C security test. The authoritative
Effect-foundation policy already owns that exact dependency/override check;
the duplicate string made the policy scanner correctly reject the test file.
Production dependencies, peer dependencies, package exports, root exports,
and all emitted graph assertions remain exact.

### Fresh dual-runtime verification

Node `v22.22.3`, pnpm `10.11.1`:

- build and all 23 WP6C tests: pass;
- combined accepted WP6B boundary/package suite: pass;
- `CI=true pnpm run test:wp5-core`: exit 0, all ten focused aliases;
- `CI=true pnpm run test:wp4-http`: exit 0, 116/116 plus three type fixtures;
- `CI=true pnpm run verify`: exit 0, including self-hosted draft E2E.

Node `v24.15.0`, pnpm `10.11.1`:

- build plus combined WP6B/WP6C/auth-package suite: 58/58;
- `CI=true pnpm run test:wp5-core`: exit 0, all ten focused aliases;
- `CI=true pnpm run test:wp4-http`: exit 0, 116/116 plus three type fixtures;
- `CI=true pnpm run verify`: exit 0, including self-hosted draft E2E.

The first sandboxed Node 22 WP4 run failed only its two real loopback tests
with `listen EPERM: operation not permitted 127.0.0.1`; the unchanged command
passed 116/116 with bounded loopback permission on both runtimes. The first
full Node 22 verifier correctly rejected the duplicated forbidden dependency
string in the test; after `b32f1b9`, the focused policy check and complete
verifier both pass. Neither event is recorded as a behavioral retry pass.

### Candidate-only boundary

This is an independent-review candidate, not WP6C acceptance. Official
authorization/client-auth conformance and integration with a real external
authorization server were not run or claimed. WP6D+, WP7+, release, issue/PR,
publication, Tier, and Goal gates remain untouched. The full readiness report
continues to truthfully retain its later conformance, release-provenance,
documentation, and agent-evidence blockers.

## WP6C first independent review and repair candidate

### Rejected candidate

A fresh independent reviewer reproduced review candidate
`15aeaf41943378515724f17176491818ad0cb47d` / tree
`46a338d1f941e630bacc3c3c5cfafa374d6bcf11`, its archive, cumulative diff,
preflight hash, ordered commits, and inventory exactly. The reviewer read the
complete preflight, all four vendored authorization sources, relevant accepted
WP6B contracts, five production modules, four tests, and complete diff.

The verdict was **`REQUEST CHANGES` — 0 Critical / 3 Important / 1 Minor**:

1. unbracketed IPv6 host-plus-port construction allowed the different origins
   `https://[::1:8443]` and `https://[::1]:8443` to share one origin key;
2. literal and repeatedly percent-encoded dot segments passed raw path-parent
   checks even though standard URL processing resolves them outside the
   accepted canonical path, and unsafe inputs reached the HTTP port;
3. pre-registration accepted any `Redacted` wrapper and unsoundly cast a
   concealed non-string value to `Redacted<string>` before saving it;
4. malformed metadata `resource` identifiers were classified as semantic
   `ResourceMismatch` before crossing the shared Schema, rather than as
   structural `AuthorizationDecodeError` (Minor).

The reviewer otherwise passed 404-only fallback, exact candidate order and
issuer equality, advertised-issuer selection, registration precedence,
`application_type`, stable scope union, Effect/package boundaries, and all
deferrals. Fresh reviewer Node 22 and Node 24 combined suites were 58/58.

### Committed meaningful repair RED

Commit `bb31da7` / tree `8f5da746b1551298f28da433806baccc21acfaec`
added focused witnesses only. Exact Node `v22.22.3` RED built successfully and
ran 16 discovery/registration tests: 12 passed and four intended tests failed
for the four reviewed behaviors. Existing tests outside those assertions
remained green. Failures were behavioral, not fixture, syntax, dependency, or
process errors:

- malformed resource returned `AuthorizationProtocolError` instead of
  `AuthorizationDecodeError`;
- the IPv6 collision returned success instead of `ResourceMismatch`;
- literal/encoded/repeatedly encoded traversal returned success and reached
  HTTP instead of failing `InvalidConfiguration` before port activity;
- `Redacted.make(123)` produced a configuration snapshot instead of rejection.

RED binary diff SHA-256 from the rejected candidate is
`f4b861aaf62775cf5c4a11928cdc9e4cbee399a19fe435e1848e648042cbd9f1`.

### Minimal GREEN

Commit `e834363` / tree `892da11c1b9aa8ebb541d6819db1873e67548ab2`:

- brackets IPv6 hosts in origin keys so host/port boundaries are unambiguous;
- repeatedly decodes bounded already-validated paths and rejects every `.` or
  `..` segment before candidate construction or port acquisition;
- verifies concealed preregistration secret and registration-token values are
  bounded, nonempty, control-free strings before retaining the wrapper;
- lets protected-resource metadata cross the shared Schema before semantic
  exact-origin/path validation, preserving structural error classification.

The GREEN changes only three package-private production modules and the
classification fixture. It changes no public API, dependency, lockfile,
package export, root export, service tag, error schema, transport, example,
generated output, conformance runner, or readiness policy.

GREEN binary diff SHA-256 from RED is
`7bf50aba2a946feb6782ca7bd6e5890526dddd9dc4b76fbbe4d05b342ea5291f`;
complete repair diff SHA-256 is
`26c972539139a96427eea00defc541384a9ed330fed5e7e005105255eda34326`;
accepted-WP6B-base cumulative diff SHA-256 is
`11c206e8ad936dd79cf692e3e0f63e013cad23a59d5c06d783bf1a23009d4953`;
and implementation archive SHA-256 is
`f3280c8872ef4476491ab85113ff41b8a080ceda302832a9dd5a55a99b1bdcc7`.

### Fresh repaired verification

Node `v22.22.3`, pnpm `10.11.1`:

- Effect-foundation policy: pass;
- WP6C: 26/26;
- combined WP6B/WP6C/auth package: 61/61;
- WP5 core: all ten focused aliases pass;
- WP4 HTTP: 116/116 plus all three public type fixtures;
- full verify: exit 0, including self-hosted draft E2E.

Node `v24.15.0`, pnpm `10.11.1`:

- combined WP6B/WP6C/auth package: 61/61;
- WP5 core: all ten focused aliases pass;
- WP4 HTTP: 116/116 plus all three public type fixtures;
- full verify: exit 0, including self-hosted draft E2E.

WP4/full commands used bounded loopback permission for their real listeners.
The readiness report remains intentionally blocked on later official
conformance, release/provenance, documentation, and agent-evidence gates.
This is a rereview candidate only: the prior `REQUEST CHANGES` remains in
force until immutable independent rereview approves it. No official auth
conformance, external authorization server, remote, issue/PR, release,
publication, Tier, WP6D+, WP7+, or Goal state was run or mutated.

## WP6C first rereview and IPv6 canonicalization repair

### Rejected first rereview candidate

The same independent reviewer reproduced rereview candidate `ba4ec76` / tree
`87330df6b92f07815cbe9b2dc1a8156e03dc2b84`, all package identities and
hashes, prior packages, repair history, inventory, and clean tracked state.
All three prior Important findings and the prior Minor were independently
reproduced as resolved. The verdict nevertheless remained **`REQUEST
CHANGES` — 0 Critical / 1 Important / 0 Minor**.

The remaining Important was valid IPv6 equivalence: bracketed host strings
were unambiguous but not address-canonical. Expanded and compressed spellings
of the same IPv6 address therefore compared as different origins, and an
expanded spelling of `::1` was not recognized as loopback, causing DCR to emit
`application_type: "web"` instead of required `"native"`.

### Second meaningful RED and GREEN

Commit `a4b6a70` / tree `151a620dd5e63b85eefe6c1446d414f06d106216`
added only two focused witnesses. Exact Node `v22.22.3` RED built successfully
and ran 18 discovery/registration tests: 16 passed and two intended tests
failed. Expanded/compressed loopback and `2001:db8` origins produced
`ResourceMismatch`, while expanded IPv6 loopback DCR emitted `web` instead of
`native`. RED binary diff SHA-256 is
`914cb6eca2ae7f528c255377b37612c2d39e04be271cc9542a41df8ba3b75e6d`.

Commit `ac4b3ec` / tree `27da551dd5f691c1842343851ffd91042a334867`
adds a package-private, platform-neutral IPv6 parser that expands validated
addresses to exactly eight 16-bit units, including embedded IPv4 endings. The
unit representation owns only origin-key equality and loopback recognition;
the original URI, request candidates, and exact issuer strings remain
unchanged. It introduces no `URL`, DOM, Node, Promise, fetch, Buffer, platform,
unstable import, dependency, public export, or Layer.

GREEN binary diff SHA-256 is
`d4611ec4d1bb4378e461ae0ed2d3622742ba3df20669685e9ea29a46f38d82fc`;
complete second repair diff SHA-256 is
`9b0dd72b87e7ebb5cc88eabb073a00e6c92473aced1a15a2edfd5119dc19f915`;
accepted-base cumulative diff SHA-256 is
`e8e8d177239e3b30442dd44932ebbef118e5ecf47bcd1b859482cf2190e73950`;
and implementation archive SHA-256 is
`d71b118abf6b3bcfa93fed033f0f9853c077a1f3754bd255bf1e4c2e657f9027`.

### Fresh second-repair verification

Node `v22.22.3`, pnpm `10.11.1`:

- Effect-foundation policy: pass;
- WP6C: 28/28;
- combined WP6B/WP6C/auth package: 63/63;
- WP5 core: all ten aliases pass;
- WP4 HTTP: 116/116 plus three public type fixtures;
- full verify: exit 0, including self-hosted draft E2E.

Node `v24.15.0`, pnpm `10.11.1`:

- combined WP6B/WP6C/auth package: 63/63;
- WP5 core: all ten aliases pass;
- WP4 HTTP: 116/116 plus three public type fixtures;
- full verify: exit 0, including self-hosted draft E2E.

This remains a second-rereview candidate only. The first-rereview `REQUEST
CHANGES` verdict remains authoritative until a fresh immutable rereview
approves the new candidate. Official authorization/client-auth conformance,
external authorization-server integration, WP6D+, remote, issue/PR, release,
publication, Tier, and Goal state remain unrun or untouched.

## WP6C second rereview and parser-hardening repair

### Rejected second-rereview candidate

The independent reviewer reproduced `7585fbc` / tree
`a83693e050f624cd5baa189d962f1772f8780730`, every sealed hash and package,
inventory, clean status, and prior repair. The earlier IPv6 equivalence and
loopback issue was fixed, but the final verdict was **`REQUEST CHANGES` — 0
Critical / 2 Important / 0 Minor**:

1. malformed embedded IPv4 followed by terminal compression, such as
   `[192.0.2.1::]`, was accepted and could alias valid `[c000:201::]`;
2. leading-zero decimal ports were compared textually, so valid equivalent
   origins such as absent/default 443 versus `:0443`, and `:8443` versus
   `:08443`, produced false `ResourceMismatch`.

All earlier findings remained independently resolved; exact request and issuer
strings remained preserved; no public/package/dependency/graph drift existed.

### Third meaningful RED and GREEN

Commit `37b0d12` / tree `f39ec10dfe8fb3aba40c9f13e553089fb033a279`
added two aggregate discovery witnesses that executed both malformed IPv4-tail
forms and three DNS/IPv6 default/nondefault decimal-port equivalence pairs.
Exact Node `v22.22.3` RED built successfully and ran 20
discovery/registration tests: 18 passed and two intended aggregate tests
failed. RED diff SHA-256 is
`ff22e28a54473b25709034454c8d8f106ccce26bdc3bdfe41b14fa033bc80f38`.

Commit `9970724` / tree `70d0ea27aed59f76983a3b0ac0046cae4736b4e0`:

- records whether an IPv6 half consumed an embedded IPv4 ending and rejects
  any compression that syntactically follows that IPv4 tail;
- converts an already bounded/validated decimal port to its numeric decimal
  spelling only inside the origin key, then applies default-port elision;
- preserves original identifiers, request candidates, exact issuer strings,
  and package/public boundaries.

GREEN diff SHA-256 is
`eede8c34c8017543b045bdee5818a655d66b62e81cb6c4e56614bc0a1af7a35c`;
complete third-repair diff SHA-256 is
`5e3fdee9f6640d8898b39382f2e2325d700a6399c449aac8bacbfd9654c1fd8d`;
accepted-base cumulative diff SHA-256 is
`3d7e4c357d31fa833fbc1929c8d3a91c170b8e1d1ee30782bea1e9f28f031260`;
and implementation archive SHA-256 is
`64f648ffdff4224a6f880fc36839c1399cec3cbeb5c31b950bd8d52a51867786`.

### Fresh third-repair verification

Node `v22.22.3`, pnpm `10.11.1`:

- Effect-foundation: pass;
- WP6C: 30/30;
- combined WP6B/WP6C/package: 65/65;
- WP5 core: all ten aliases pass;
- WP4 HTTP: 116/116 plus three public type fixtures;
- full verify: exit 0 including self-hosted draft E2E.

Node `v24.15.0`, pnpm `10.11.1`:

- combined WP6B/WP6C/package: 65/65;
- WP5 core: all ten aliases pass;
- WP4 HTTP: 116/116 plus three public type fixtures;
- full verify: exit 0 including self-hosted draft E2E.

This remains a third-rereview candidate only. The second-rereview `REQUEST
CHANGES` verdict remains authoritative pending immutable approval. Official
auth/client-auth conformance, external AS integration, WP6D+, remote,
issue/PR, release, publication, Tier, and Goal state remain unrun or untouched.
