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

## WP6C independent acceptance closeout

The independent third rereview reproduced candidate
`2645fed69bdca7e1fcce4bd42c7adcf722d04627` / tree
`5d437a80101ac31d42bfd60b6514530a5f9e3e64` and returned **`APPROVE` —
0 Critical / 0 Important / 0 Minor**.

The reviewer reproduced every sealed identity without drift:

- candidate archive SHA-256
  `7fd3c9cb31c98f2e578405698b764b357838c7fd7c5ec25fb16fdf82675b5b62`;
- accepted-base cumulative diff SHA-256
  `55b99dc862f6e2e804e7380e02d6d41202a65a2646315522243f1c404e51d028`;
- second-rereview-to-current diff SHA-256
  `dd4e418f78e6a1cb2da9e310b208c3c7c034f0d1a13ccec26e661809803d4870`;
- RED, GREEN, and complete-repair diff SHA-256 values
  `ff22e28a54473b25709034454c8d8f106ccce26bdc3bdfe41b14fa033bc80f38`,
  `eede8c34c8017543b045bdee5818a655d66b62e81cb6c4e56614bc0a1af7a35c`,
  and `5e3fdee9f6640d8898b39382f2e2325d700a6399c449aac8bacbfd9654c1fd8d`;
- GREEN archive SHA-256
  `64f648ffdff4224a6f880fc36839c1399cec3cbeb5c31b950bd8d52a51867786`;
- third-rereview package SHA-256
  `aa49859be87d6553586099301605d6b9138f58e656d688c8fd2f0b71c24267e0`.

The immutable reviewer matrix independently confirmed rejection of embedded
IPv4 followed by IPv6 compression, equivalence of valid terminal embedded-IPv4
and hexadecimal spellings, numeric comparison of default and nondefault ports
including boundaries 0 and 65535, IPv6 equivalence and loopback recognition,
traversal rejection, concealed-secret refinement, malformed-resource error
classification, and exact preservation of request and issuer spellings.

Fresh reviewer execution passed Node `v22.22.3` and `v24.15.0`: WP6C 30/30
where run directly, combined auth/package 65/65, all ten WP5 core aliases, WP4
HTTP 116/116 plus three type fixtures, and full `verify` including both draft
E2E executions. The tracked status remained clean during review and
`git diff --check` passed. No public API, dependency, lockfile, generated,
platform, transport, example, Layer, or WP6D+ drift was found.

WP6C is accepted locally. This acceptance does not claim official
authorization/client-auth conformance, real external authorization-server
integration, WP6D+, remote/issue/PR mutation, release/publication, Tier
qualification, or Goal completion; all remain deferred to their prescribed
gates.

## WP6D authorization transaction and token candidate

### Scope and test-first evidence

WP6D remains package-private and adds only the Effect-native authorization
transaction/token core prescribed by the plan: PKCE S256, one-use state,
exact redirect matching, the four authorization-response `iss` cases,
authorization denial, RFC 8707 resource continuity, code exchange, refresh,
opaque-token audience validation, issuer/client credential partitioning, and
typed/cause-preserving failures. It does not add the WP6E HTTP challenge,
transport, or protected-resource integration and does not change a public
runtime export.

RED commit `f055679` specified the boundary in
`test/auth/wp6d-client-transaction.test.mjs` and
`test/auth/wp6d-client-token.test.mjs`. Exact Node `v22.22.3` RED built
successfully and ran 13 aggregate tests: 0 passed and all 13 intended tests
failed solely because the package-private `transaction.js` and `token.js`
modules did not exist. RED binary diff SHA-256 is
`d177a1bb08eebd60e4b087bc0ae5220a4a2b8d40191f599afafe595935728e46`.

The first implementation made all 13 aggregate tests green. Coordinator
review then added three aggregate hostile-boundary witnesses, producing a
meaningful post-GREEN RED: the original 13 remained green and exactly three
new tests failed. Those tests require omitted `receivedAt` to use the
contextual Effect `Clock` while preserving zero, case-insensitive Bearer
canonicalization with DPoP rejection, and real Effect `Option` values while
rejecting plain `_tag` spoofs, revoked proxies, and accessors without invoking
getters.

GREEN commit `52d05bc` / tree
`4c384b2ce3014c9a605aff6cb6a828dda8f58b1e` adds
`src/auth/client/encoding.ts`, `src/auth/client/transaction.ts`,
`src/auth/client/token.ts`, and the package-private stored-transaction model
field. All 16 aggregate tests pass. The implementation uses an explicitly
provided `Clock` service when present and otherwise the Effect runtime clock;
it uses Effect `Option` recognition plus descriptor/prototype checks at the
hostile optional-credential boundary. It introduces no Promise, fetch, URL,
URLSearchParams, TextEncoder, TextDecoder, Buffer, Node, DOM, platform, or
unstable production dependency/import.

Candidate identities are:

- commit `52d05bcd9b0fde1fca268764001763a4de135945`;
- tree `4c384b2ce3014c9a605aff6cb6a828dda8f58b1e`;
- archive SHA-256
  `a69ab6dce5801227152af426be294463fa0d52d6286a262833519a00b968e030`;
- accepted-WP6C-base cumulative diff SHA-256
  `8351804132cbf18952e365758ab396b00bbe6aea68e47bbdc02f606bc0279764`;
- GREEN diff SHA-256
  `3ec72ceb9db06f26df3bf9c707960884225ab0de91578e61ac83a7728028b903`.

### Fresh candidate verification

Node `v22.22.3`, pnpm `10.11.1`:

- WP6D: 16/16;
- WP6A source refresh: 5/5;
- combined WP6B/WP6C/auth package: 65/65;
- public WP6B authorization type fixture: pass;
- Effect-foundation policy and tests: pass, 8/8;
- SDK runtime and explicit production-boundary scan: pass;
- full `pnpm run verify`: exit 0, including WP4 HTTP 116/116 plus three
  public type fixtures, every WP5 alias/package gate, and both self-hosted
  draft E2E executions.

Node `v24.15.0`, pnpm `10.11.1`:

- WP6D: 16/16;
- full `pnpm run verify`: exit 0, including WP4 HTTP 116/116 plus three
  public type fixtures, every WP5 alias/package gate, and both self-hosted
  draft E2E executions.

The readiness compiler remains deliberately blocked on draft-targeted
official conformance evidence, release provenance/stable release,
documentation coverage, and agent-evaluation evidence. This is a WP6D
candidate, not local acceptance: official authorization/client-auth
conformance, real external authorization-server integration, WP6E+, remote,
issue/PR, release/publication, Tier qualification, and Goal completion remain
unrun or deferred pending their exact gates and an immutable independent WP6D
review.

### First independent review and bounded repair candidate

The first immutable independent WP6D review returned **REQUEST CHANGES: 0
Critical / 8 Important / 0 Minor**. The eight blocking findings were:

1. a transaction was bound to a credential handle but not the exact client ID,
   so a mutable credential record could substitute another client;
2. the authorization-response `iss` requirement was read again at completion
   instead of being fixed when the transaction started;
3. malformed callback data was validated before consuming the transaction,
   leaving a replayable state handle;
4. persisted state and verifier values accepted arbitrary bounded strings
   rather than the generated 43-character base64url shape;
5. token endpoint authentication metadata was ignored and every confidential
   client used a form-body secret instead of honoring `none`,
   `client_secret_post`, and `client_secret_basic`;
6. an empty scope was serialized as `scope=` instead of being omitted;
7. null top-level inputs could defect before returning a typed authorization
   error; and
8. an object below the canonical Effect `Option` prototype could forge the
   optional-credential boundary.

The repair began with test-only commit
`1ceb8a3c3ebfa5a4f70ac2e6bc938f998d0e979e` / tree
`edfc868ff37d3c8531cec59428c4d05616eeae83`. Under Node `v22.22.3`, the
build passed, the original WP6D 16/16 remained green, and exactly eight new
aggregate WP6D witnesses failed (24 total). The prior WP6C registration 6/6
remained green and its new persistence witness failed (7 total). Repair-RED
binary diff SHA-256 from the first-review candidate is
`f3c957c43baf1a5013e5b2fc3cf4c85c8e908003a5aafafc01572808341ef04c`.

Production-only GREEN commit
`60c3f2b9156725560713e5dfb7981a6b53fd7d63` / tree
`c692f717d542c81f67fca2eea0cafdbb7a016135` binds each transaction to the
exact client ID and start-time response-issuer policy; consumes a valid state
handle before validating the remaining callback; validates the exact generated
state/verifier shape; persists and honors the supported token endpoint
authentication method with redacted, platform-neutral Basic construction;
omits empty scope; snapshots all five top-level operation inputs without
invoking accessors; and stores the exact credential handle on new grants.
Refresh therefore avoids an Effect `Option` lookup for new grants, while the
legacy fallback accepts only canonical Option prototypes and rejects deeper
prototype forgeries. Repair-GREEN binary diff SHA-256 is
`69a4571dd271a6006d886dc07efe3238ad707b1a518708a2b31a4fce02865840`.

At GREEN, before this evidence-ledger commit, the repaired candidate identity
was commit `60c3f2b9156725560713e5dfb7981a6b53fd7d63`, tree
`c692f717d542c81f67fca2eea0cafdbb7a016135`, and archive SHA-256
`930980ec76549e1c303f510ef96e4567a31ed15e2dc5de4d166bbd36e7b1347c`.
The complete first-review-candidate-to-GREEN binary diff SHA-256 is
`c639fb994254b6ad6e2cd8daa00d81c74e259f8832f929375925da3ef28bb84b`;
the accepted-WP6C-base cumulative binary diff SHA-256 is
`dc4b961f8e7190d9fe0a5e6b3bd3d643e439ca75ab5aa04f9e41ae185622d718`.

Fresh coordinator verification passed on both Node `v22.22.3` and
`v24.15.0`: explicit WP6D 24/24 and full `pnpm run verify`, including WP4
HTTP 116/116 plus three public type fixtures, every WP5 alias/package gate,
and both self-hosted draft E2E executions. Node 22 additionally passed the
combined authorization/package suite 89/89, the public WP6B authorization type
fixture, the Effect-foundation policy and 8/8 tests, the SDK runtime check, and
the explicit production-boundary scan. `git diff --check` passed and the
tracked worktree was clean.

The readiness compiler continues to report the required blockers for official
draft conformance, release provenance/stable release, documentation, and agent
evidence. This is a **rereview candidate only**: the prior REQUEST CHANGES
verdict remains authoritative until a fresh immutable independent review
approves the exact repaired candidate. No official authorization/client-auth
conformance, external authorization-server integration, WP6E+, remote or
issue/PR mutation, release/publication, Tier qualification, or Goal completion
is claimed.

### Second independent review and bounded repair candidate

The sealed first-rereview package SHA-256 was
`710bb547bb537b0bdb7446ddbfc5e497cafd0a918874904e4595494d561a6fb4`.
A fresh independent reviewer reproduced its candidate commit/tree/archive and
all listed binary diffs, confirmed an unchanged tracked tree and unchanged
tests after the prior RED, and returned **REQUEST CHANGES: 0 Critical / 3
Important / 0 Minor**. The three remaining blocking findings were:

1. persisted transactions and completed authorizations still allowed an absent
   client ID, permitting a rehydrated record to exchange using a substituted
   same-issuer credential;
2. the persisted start-time response-issuer policy was still optional, so an
   incomplete rehydrated record could fall back to mutable callback metadata;
3. token authentication only validated a preselected method: a methodless
   confidential credential did not select an advertised method, omission of
   the metadata list incorrectly defaulted to POST instead of Basic, and DCR
   did not reconcile its server-returned method.

The reviewer classified the prior malformed-callback one-use state, exact
state/verifier shape, empty-scope omission, null/accessor containment, and
deeper-prototype Option-forgery findings as fixed. It independently passed
WP6D 24/24 and authorization/package 89/89 on Node `v22.22.3` and
`v24.15.0`, plus the public type fixture and relevant policy/runtime checks.
Its sandboxed full Node 22 run reached the live-loopback gates before receiving
`listen EPERM`; that was an environment constraint, not acceptance evidence.

The second repair began at test-only commit
`9decd4c4868f010d18dd41c7e75e114743f45a48` / tree
`75c9743113a78d93c82a6c98fc88c6f935c3c0a7`. Coordinator-recomputed
binary diff SHA-256 from the first-rereview candidate is
`69a0fd2dc378974b602de2eb63b05738fdcb2864ec5b614679b926b481e9e0d9`.
Node `v22.22.3` built successfully and ran 35 focused aggregate cases: all 31
prior cases remained green and exactly four new witnesses failed for the three
findings, with one aggregate witness exercising both missing-client-ID stages.

That RED exposed two semantically ambiguous legacy fixtures rather than
production behavior: secret-bearing methodless credentials asserted POST, and
the public stored-transaction type mock omitted the newly required bindings.
No assertion or new witness was weakened. Test-only normalization commit
`5500ab736768720524c31c1f5d9abf922a450788` made legacy POST intent
explicit; its coordinator-recomputed binary diff SHA-256 is
`613116610ef05d8e378ba3ca2dda1ea54e674de71770168b81130aad7d1c640e`.
Test/type-only normalization commit
`0cc3c3609f4e6cb0a5966375c6a115a48dea3672` added the required fields to
the public type mock; its binary diff SHA-256 is
`2fe61f36514a1358c93f74d64cec5c13a69446ef0541586eb1eb09e3561e58fd`.
At that final normalized RED boundary, build and the public type fixture passed
and the focused suite remained exactly 31 pass / 4 intended fail. The complete
initial-to-normalized repair-RED binary diff SHA-256 is
`73851d8ec312f859a7dafd8e8f50bad5859d8f66866c28412df6a075ca593e96`.

Production-only GREEN commit
`6238bcae081fedf310fe479aa136fe449f736ea0` / tree
`bb27883ea7ec673b17b05501f82eee8d1b7050e8` makes both persisted
transaction bindings required and fails incomplete rehydrated transactions or
completed authorizations before credential or HTTP work. It adds one private,
platform-neutral token-auth-method selector shared by registration and token
exchange: explicit methods must be secret- and metadata-compatible;
methodless confidential credentials select supported Basic before POST and use
the metadata default of Basic when the field is absent; public credentials use
`none` only when compatible; and DCR persists a compatible server-returned
method while rejecting unsupported or secret-inconsistent responses before
save. No tests or type fixtures changed after the final normalized RED.

The production GREEN binary diff SHA-256 is
`684006e8530e3a3a4b01e451c9fa223438558095706c3d95a712152dc9537075`.
The complete first-rereview-candidate-to-GREEN binary diff SHA-256 is
`ce4e2ce84ddc9a0c07b0c4390e1aba7e3ff77c078cb89a0ee93cf8f5f97989be`.
Before this evidence-ledger commit, the repaired candidate archive SHA-256 is
`e547348b8a3f6e182dfae31bbe0968ec68224b9ca0d3e7386512af73244f4f4a`
and the accepted-WP6C-base cumulative binary diff SHA-256 is
`b70351144cb08a25499cb9820574c850fab30abb1d445327e56d2ca3f1a76092`.

Fresh coordinator verification passed under both exact supported Node lines:

- Node `v22.22.3`: build; authorization/package 93/93, including focused
  WP6D 27/27; public authorization type fixture; Effect policy and 8/8 tests;
  SDK runtime; explicit platform scan; and full `pnpm run verify` exit 0;
- Node `v24.15.0`: build; authorization/package 93/93; public authorization
  type fixture; and full `pnpm run verify` exit 0.

Both full lanes included WP4 HTTP 116/116 and its three public type fixtures,
every WP5 alias/package gate, and both self-hosted draft E2E executions.
`git diff --check` passed, the tracked tree was clean, and the production diff
contains no dependency, lockfile, generated, public-export, transport, example,
WP6E, Node, DOM/Web, Promise, or unstable Effect drift.

The readiness compiler remains deliberately blocked on draft-targeted official
conformance, release provenance/stable release, documentation, and agent
evidence. This is a **second-rereview candidate only**: the latest REQUEST
CHANGES verdict remains authoritative until a new immutable independent review
approves this exact candidate. No official authorization/client-auth
conformance, external authorization-server integration, WP6E+, remote or
issue/PR mutation, release/publication, Tier qualification, or Goal completion
is claimed.

### Third independent review and narrow repair candidate

The sealed second-rereview package SHA-256 was
`3ecdd65f6a03d69edae04334fd2c902df5b3e5d349cba4a0c91db17820dde546`.
The independent reviewer reproduced every frozen identity, confirmed the
test/type normalizations and production scope, passed the focused matrix on
both Node lines, and returned **REQUEST CHANGES: 0 Critical / 1 Important / 0
Minor**. The exact remaining finding was that DCR validated a returned token
authentication method against the local enum and secret shape but not against
the authorization server's advertised method list; it could therefore persist
an unusable `client_secret_basic` credential when metadata advertised only
`client_secret_post`.

The reviewer classified the rehydrated client-ID binding, persisted start-time
response-issuer policy, methodless confidential selection/defaulting, explicit
POST intent, public `none` compatibility, and every first-repair behavior as
fixed. It passed Node `v22.22.3` and `v24.15.0` build, WP6D 27/27,
authorization/package 93/93, and the public authorization type fixture. Its
sandboxed full verification reached the loopback gate before `listen EPERM`;
the coordinator's unrestricted full runs below are the local package-health
evidence.

Test-only RED commit `5cc88ba27d12f4732d20c405ddab3ba1a2e39fc6` / tree
`b42f474148826fc1ba4a1b83ace3a44c67a1318b` adds one DCR witness: metadata
advertises only POST, the registration response returns Basic with a valid
secret, and resolution must return typed `RegistrationFailed` after the one
registration request while saving zero credentials. Under Node `v22.22.3`,
the build passed and the focused aggregate ran 36 cases: all 35 prior cases
remained green and exactly the new witness failed because one credential was
saved. RED binary diff SHA-256 is
`05c7907755e7e02919d1d85ce417701e5d4700b10120d4f775287d7e3d8d8263`.

Production-only GREEN commit
`4def773705ffccbe08135b8897a8842d63ce7c36` / tree
`a66a1ebb87d8646b31afca9506ce788d61954031` changes only
`src/auth/client/registration.ts`. After a descriptor-safe metadata read, DCR
now passes its returned/fallback method, secret presence, and advertised list
through the existing shared selector before persistence; incompatibility
returns typed `RegistrationFailed` and saves nothing. No test changed after
RED and no new abstraction was added. GREEN binary diff SHA-256 is
`a04ef6f951cb63dbc3d4c90509a2298edf9183b781e0b5fa92d8d6ae5f808583`.

Before this evidence-ledger commit, the third repair has these identities:

- second-rereview-candidate-to-GREEN binary diff SHA-256
  `5f9d27588c192f5aefba8b8985cc4042e275e0547cb5d234e7e6731647260efa`;
- accepted-WP6C-base cumulative binary diff SHA-256
  `742c4f5257ef7d52df3bfc0ca3911d24ec1b326a1a9295c9fe1df90596f2ddb6`;
- candidate archive SHA-256
  `1a40fd237ddbfe14307c7d8e71b911634338456ee4277ca09f0b6807af1577c6`.

Fresh coordinator verification passed:

- Node `v22.22.3`: build, focused 36/36, authorization/package 94/94,
  public authorization type fixture, and full `pnpm run verify` exit 0;
- Node `v24.15.0`: build, focused 36/36, authorization/package 94/94,
  public authorization type fixture, and full `pnpm run verify` exit 0.

Both full lanes included WP4 HTTP 116/116 and three public type fixtures,
every WP5 alias/package gate, both self-hosted draft E2E executions, and the
truthful readiness result. `git diff --check` passed and the tracked tree was
clean.

The readiness compiler remains deliberately blocked on draft-targeted official
conformance, release provenance/stable release, documentation, and agent
evidence. This is a **third-rereview candidate only**: the latest REQUEST
CHANGES verdict remains authoritative until a fresh immutable independent
review approves the exact candidate. No official authorization/client-auth
conformance, external authorization-server integration, WP6E+, remote or
issue/PR mutation, release/publication, Tier qualification, or Goal completion
is claimed.

### WP6D local acceptance closeout

The final sealed rereview package SHA-256 was
`7b83b3703db4ca4a655c4b5eb9fa6ed639c1b23abf513681447cb7536b472b5a`.
The independent reviewer returned **APPROVE: 0 Critical / 0 Important / 0
Minor** with no findings.

The reviewer reproduced the exact accepted candidate commit
`229e5677b12f9d88609cfbd97dcb16a34d3efe3a`, tree
`9dbd923be1b915e056d32f90d2d26e1de5336774`, archive SHA-256
`85a62097d480e3c713c18114c9c862ca64f7928af795092da4dd7af06948de42`,
accepted-base cumulative binary diff SHA-256
`fc4675b89ffa78495e9a7c5934278a6daa45f1d71ac6b4cc2ae1c6a127b8e3db`,
prior-candidate-to-final binary diff SHA-256
`3344f7b0d5779ae4db055f66b1647ba2622c4ab70e102ed47e2a1447c67ece68`,
and the exact third RED/GREEN identities and hashes. Prompt, plan, and
preflight identities remained unchanged; tracked status was clean before and
after review and `git diff --check` passed.

The reviewer independently confirmed the prior DCR finding is resolved by the
generic shared selector before persistence, with a direct runtime probe
returning typed `RegistrationFailed` and zero saves for advertised POST versus
returned Basic. It passed Node `v22.22.3` build, focused 36/36,
authorization/package 94/94, public type, Effect foundation 8/8, source refresh
5/5, runtime and platform checks; Node `v24.15.0` passed build, focused 36/36,
authorization/package 94/94, and public type. The coordinator's sealed
candidate evidence additionally records full `pnpm run verify` exit 0 under
both Node lines with live loopback, WP4 HTTP 116/116, all WP5 gates, and both
self-hosted draft E2E executions.

WP6D is accepted locally. This acceptance does not claim official
authorization/client-auth conformance, real external authorization-server
integration, WP6E+, remote or issue/PR mutation, release/publication, Tier
qualification, or Goal completion. Those remain deferred to their prescribed
gates.

## WP6E Streamable HTTP authorization candidate

WP6E began from accepted WP6D closeout
`4772ba713157a5d7c854a9ee445f4bf481aacfc7`. The bounded implementation
replaces the transport's raw mutable `authProvider` callback with an
Effect-native authorization client/store service value, gives authorization
and HeaderMismatch recovery independent one-use budgets, parses standards-
valid Bearer challenges from single- and multi-scheme headers, and prevents a
caller Authorization header from bypassing SDK-owned authorization.

The protected-resource transport now owns the configured verifier boundary
before MCP body dispatch. Only the verifier receives a Redacted bearer value;
only a decoded, token-free `AuthorizationPrincipal` reaches dispatcher and
notification context. Missing/malformed credentials and invalid/expired/
audience-mismatched tokens map to deterministic 401 Bearer challenges;
insufficient scope maps to a deterministic 403 `insufficient_scope`
challenge; verifier unavailability/defect becomes a non-challenge 500; and
interruption remains interruption. The former token-bearing `authInfo` hook is
replaced by the token-free `verifiedAuthorizationPrincipal` embedding hook and
cannot bypass configured verification.

### TDD sequence and immutable identities

- client HTTP RED `1e3b52f8f251deca22a56f03f1b580948d525833`:
  6 cases, 1 prior behavior pass and 5 intended failures; binary diff SHA-256
  `8b3b8b0c967efde7f82a2b462d417e30da472b274608495eba7a4ac22789937a`;
- protected-resource RED and authorized WP4 server migration
  `d0e9f5f86c34e7d968b40b0ce60bbc24c8fc27fb`: 6/6 intended
  runtime failures plus the intended public type errors; binary diff SHA-256
  `1f39f3946ad7597a8fd327c841ee90f51633691d60b97b4843e590eee7942f9d`;
- accepted WP4 client test normalization
  `85e5cbe9e6288977596c2300231f843b34871dd5`: 5/5 intended
  failures against the missing Effect-native seam; binary diff SHA-256
  `71ef178920a85633945ca19aaa273525affed522e70a4682bd5c49d04d5f0407`;
- client GREEN plus coordinator-approved compile migration
  `43c46d8180cb98c9f79e585f167f245023a8f662`; binary diff SHA-256
  `00451e81fd981feacd1c0bbb331c0784a58df45171e09bbf9967383d95be7cd0`;
- protected-resource fixture normalization
  `acac767e3598781943eefe48b6c925f0761b4449`; binary diff SHA-256
  `a2f95ca357b6c7ac3bfac3f55e46f3c8c90091b3a09e80bc78a82ab4361ff809`;
- server GREEN `75562aa363ec49a368013f66a6d6f3e6be15f815`; binary diff
  SHA-256
  `f76f66c1d610fc1dda265ee5d402af24b7640dba57a4833c8bf8592b798b396c`;
- multi-scheme challenge RED
  `7612eaac1fb9f96a6f21a4a779e6d8c7be35a412`: 1/1 intended
  failure; binary diff SHA-256
  `28b82fac3956d51641b71cb1d63a47035f14546f6d93641236601203af7211fa`;
- final parser GREEN `598b7c2650057bf5a14c7b3f6e965147e1598829`; binary
  diff SHA-256
  `90169746037ed8fadf90a4aea62f0553a78768f4a5f7b327ed551ec5edf4d4c0`.

The final code candidate tree is
`e7ed70ed5ff7f888c6704a6a3330835f3eccf332`. Its archive SHA-256 is
`920d04af8fe3c49c78466690f2862585cce22e417b777b41ba75ffdf3fc58f43`
and its accepted-WP6D-base cumulative binary diff SHA-256 is
`57baa71606fcc4172e4a59c964bd29e349e4e2bf551084febcd4ffaafa07bd15`.

The scope amendment in `.superpowers/sdd/task-6-preflight.md` authorizes only
the compile-preserving removal/migration at
`src/examples/core-protocol-catalog.ts` and
`src/examples/everything-client.ts`. Actual public authorization examples,
package aliases, cumulative WP6 scripts, governance, and evidence remain WP6F.
No dependency, lockfile, generated protocol/schema, package/script, external
authorization-server, remote, issue, release, or Tier mutation occurred.

### Final candidate verification

The implementer passed the focused authorization matrix before the final
parser repair at 102/102 on both Node lines, WP4 HTTP at 116/116 plus all three
public type fixtures on both Node lines, Node 22 `test:wp5-core`, and full
`pnpm run verify` on both Node lines. After the isolated parser repair, both
Node lines passed build and the focused client suite at 7/7.

The coordinator then verified the exact final candidate:

- Node `v22.22.3`: direct WP6 auth/client/server HTTP matrix 103/103; the
  protected-resource public type fixture; and full `pnpm run verify` exit 0
  with loopback permission;
- Node `v24.15.0`: direct WP6 auth/client/server HTTP matrix 103/103; the
  protected-resource public type fixture; and full `pnpm run verify` exit 0
  with loopback permission;
- both full lanes include WP4 HTTP 116/116 plus three public type fixtures,
  every accepted WP5 gate, and both self-hosted draft E2E executions;
- `git diff --check` passed and the tracked worktree was clean.

One diagnostic Node 22 run inside the restricted sandbox failed only at the
two loopback-owning gates (`test:wp4-http` and draft E2E) with `listen EPERM
127.0.0.1`; it was not counted. The exact same candidate and command then
passed outside that loopback restriction.

Readiness remains deliberately blocked on draft-targeted official conformance,
release provenance/stable release, documentation, and agent evidence. This is
a **WP6E independent-review candidate only**. No official client-auth or
authorization conformance, real external authorization-server integration,
WP6F+, remote or issue/PR mutation, release/publication, Tier qualification,
or Goal completion is claimed.

### First WP6E independent review

The sealed review package SHA-256 was
`8a500aa6b24b02f4ce87f2ad86fa7148aa76888483810379878ae02f024ec0c3`.
The reviewer reproduced the evidence HEAD/tree, code candidate/tree/archive,
accepted-base cumulative diff, prompt/plan/preflight hashes, all eight TDD
commits, and every per-step binary diff hash. The tracked tree remained clean
and `git diff --check` passed.

The verdict was **REQUEST CHANGES: 0 Critical / 6 Important / 0 Minor**:

1. an authorized injected fetch rejection could copy its observed raw Bearer
   header into `TransportError.cause`;
2. a verifier Cause containing typed `Invalid` plus a defect or mixed
   interruption could be mislabeled as a 401 token fact;
3. the challenge splitter used a strict subset of HTTP `token`, rejecting a
   standards-valid digit-leading scheme and valid extension parameter names;
4. `AuthorizationScope` admitted characters excluded by RFC 6750, including
   NUL, which could defect challenge header construction instead of returning
   deterministic 401;
5. the protected-resource subpath did not yet own its frozen public bearer
   extraction/verification, scope-policy, and serialized challenge helpers;
6. the reverse HeaderMismatch-before-authorization recovery ordering worked in
   a probe but lacked its required committed regression test.

Independent Node 22 and Node 24 direct matrices passed 103/103 with the public
type fixture; WP4 HTTP passed 116/116 plus three type fixtures on both supported
Node lines; and Node 22 full `pnpm run verify` passed with loopback. Those green
gates do not override the blocking findings. No official conformance, external
authorization-server, remote, issue/PR, release, Tier, or Goal mutation was
performed.

### WP6E review repair candidate

The coordinator bounded all six Important findings in the committed preflight
amendment `f0fab856d160d6798e3ec9a4b5752ed8c7e020e7`. A fresh implementer then
created one test-only RED group before any production repair:

- RED `fb5e3b6eca9cd00074fd11402840269f2f5c77c4`; binary diff
  SHA-256 `845759cd65aca8f10a37a9b9458383e3ed021c8fb4e14931aca24728c88f388a`.
  On Node 22 the client HTTP suite was 8/11 with three intended failures,
  protected-resource HTTP was 6/9 with three intended failures, the public
  boundary was 12/18 with six intended failures, the package boundary was 2/4
  with two intended failures, and both new public type fixtures failed only on
  the absent helpers/signatures. The reverse HeaderMismatch-before-
  authorization witness already passed, proving its defect was missing durable
  coverage rather than broken runtime behavior.

The production GREEN sequence was:

- public protected-resource helpers and RFC 6750 scope grammar
  `c3a6056050fdac10cff1ac5ccee5a1ce9811e463`; binary diff SHA-256
  `ff297287a6bf9680256cbfd450f8dbb4d5f4978dbc0988117484dc7302d9b77c`;
- authorized-fetch Cause confinement and full HTTP `token` challenge parsing
  `02f47e9e7cf558f972b6a581304f5b8f06f6453e`; binary diff SHA-256
  `64404de17e7a27433e52e23ee61c1411a42d8d65e9a1b833ec31f2739c147f2b`;
- server reuse of the public middleware/serializer and pure typed-Cause
  classification `9198c4730c37471d4b63db6fe8acb0933daad728`; binary diff
  SHA-256 `d3cfecf96d1980bf022b4150b568387611de308cab6dbec5d390f9890d78e800`.

No test was weakened after RED. The bounded repair from the approved amendment
to the code candidate has binary diff SHA-256
`a1fc5976d6d13d7fba3862c38ad915748dfa583e2bd7bffa5e7baf19454e00ce`.
The final candidate tree is
`807a5fd5d53d75d5fe022319cf38cef1d29a021b`; its archive SHA-256 is
`a0058f04658d76835389546ccef85ab0c8387223b6115efd154c00d553e8f2f4`;
and its accepted-WP6D-base cumulative binary diff SHA-256 is
`5be7e9cf1d68db4ce6dbe195fd882b9384fb12bb6569972f92b3159bc09185d6`.

The repaired public protected-resource subpath now owns typed bearer
extraction to `Redacted`, verifier composition, exact token-free principal
validation, scope policy, and deterministic challenge serialization. The
server transport reuses that boundary. Only a pure typed verifier failure can
become a 401 token fact; composite defects return a non-challenge 500 and any
Cause containing interruption remains interruption. Authorized injected-fetch
rejections cannot retain arbitrary causes containing a bearer token, while
ordinary unauthenticated fetch failures retain their existing Cause contract.

Fresh implementer verification passed build plus the direct WP6
auth/HTTP/package matrix at 118/118 and both protected-resource type fixtures
on Node `v22.22.3` and `v24.15.0`. Restricted WP4 diagnostics were 114/116 on
both runtimes solely because the two real listener cases received `listen
EPERM 127.0.0.1`; they were not counted.

The coordinator then ran the exact candidate with loopback permission:

- Node `v22.22.3`: full `CI=true pnpm run verify`, exit 0;
- Node `v24.15.0`: full `CI=true pnpm run verify`, exit 0.

Both authoritative lanes include WP4 HTTP 116/116 plus all three public type
fixtures, every accepted WP5 gate, the repaired WP6 direct/package boundaries,
and both self-hosted draft E2E executions. `git diff --check` passed and the
tracked tree was clean.

Readiness remains deliberately blocked on draft-targeted official conformance,
release provenance/stable release, published documentation, and agent evidence.
This is a **WP6E rereview candidate only**. No official client-auth or
authorization conformance, real external authorization-server integration,
WP6F+, remote or issue/PR mutation, release/publication, Tier qualification,
or Goal completion is claimed.

### First WP6E repair rereview

The sealed rereview package SHA-256 was
`a79e975858e9da8dc0b2a5f2af394a524accc53afe1c60f72ef03f7ac42b9021`.
The fresh reviewer reproduced every evidence/code tree, archive, cumulative and
step diff, authority/evidence hash, exact file inventory, clean status, and
`git diff --check` result. The reviewer independently passed the direct WP6
auth/HTTP/package matrix at 118/118, both protected-resource type fixtures,
WP4 HTTP 116/116 plus three type fixtures, and full `pnpm run verify` including
both draft E2E runs on Node `v22.22.3` and `v24.15.0`.

The verdict was **REQUEST CHANGES: 0 Critical / 1 Important / 0 Minor**. Five
of the six original findings were fully resolved, and the sixth was only
partially resolved: the public middleware still kept exact principal
normalization private, while `StreamableHttpServerTransport` retained a second
private duplicate solely for `verifiedAuthorizationPrincipal`. Because the
compatibility hook exists, the frozen protected-resource boundary requires a
public token-free already-verified embedding adapter and transport reuse. The
source-reuse regression also omitted that duplicate.

No additional authorization, challenge, cancellation, principal-confinement,
secret-exposure, TDD-integrity, scope, or example-migration finding was found.
Green verification does not override the blocking ownership finding. No
official conformance, external authorization-server, remote, issue/PR,
release, Tier, or Goal mutation was performed.

### WP6E exact-principal ownership repair candidate

The coordinator bounded the single remaining Important finding in amendment
`e1cba69`. A fresh implementer committed test-only RED
`8b0264644ec4b8d50e8c7baaa8b4fdad1c048301` before production; its binary diff
SHA-256 is
`2ae568c0080e5d0f837b7994de239b03a2033f08b8e440a778183842556a2582`.
On Node 22 the protected-resource boundary was 16/19 with three intended
failures, the package boundary was 2/4 with two intended failures, and both
public type fixtures failed only with TS2339 for the absent adapter. Existing
behavioral assertions remained green.

Production GREEN `6b60f8e95d07167781681c19addddac3140d4d82`
has binary diff SHA-256
`13940fffcc0df0972b0057c74123d5ae7f278be13fce435852eac1d741a052a3`.
It exports the platform-neutral Effect adapter
`embedVerifiedAuthorizationPrincipal`, requires an exact
`AuthorizationPrincipal` prototype and exact allowed own data descriptors,
schema-decodes a fresh token-free snapshot, and returns safe typed
`TokenVerificationError` reason `VerifierFailure` for non-exact or hostile
input. Both `verifyBearerAuthorization` and the server's
`verifiedAuthorizationPrincipal` hook reuse the adapter; both private
`exactAuthorizationPrincipal` duplicates are removed. No test changed after
RED.

The amendment-to-final binary diff SHA-256 is
`d2a78c2cf2952c4660f80c81114ce0608752b54ba0f5311c01090dbd3beb1fac`;
the prior-repair-to-final binary diff SHA-256 is
`323762b6573e1b716634e4fbe3411f586abe1a9a23ad701dc850c53d903af3a2`;
and the accepted-WP6D-base cumulative binary diff SHA-256 is
`0cc89ec59a6ce48e20a5e141372f2acbc63525bb2e4f007c706298639f825da1`.
The final code tree is `c426534260410c3466bc55aef193fbe6e22b8c37` and
its archive SHA-256 is
`52a9a5cb05988e2685654105ee30102cbbe6074c9076866151012a791f18285d`.

The implementer passed the direct WP6 matrix at 119/119, both public type
fixtures, and WP4 HTTP 116/116 plus three type fixtures on Node `v22.22.3` and
`v24.15.0`; Node 24 full `pnpm run verify` exited 0. The coordinator then
reproduced the exact final code candidate:

- Node `v22.22.3`: build, direct WP6 119/119, both public type fixtures, and
  full `CI=true pnpm run verify` exit 0;
- Node `v24.15.0`: direct WP6 119/119, both public type fixtures, and full
  `CI=true pnpm run verify` exit 0.

Both full lanes include WP4 HTTP 116/116 plus three public type fixtures, every
accepted WP5 gate, and both self-hosted draft E2E executions. `git diff
--check` passed and the tracked tree was clean.

Readiness remains deliberately blocked on draft-targeted official conformance,
release provenance/stable release, published documentation, and agent evidence.
This is a **final WP6E rereview candidate only**. No official client-auth or
authorization conformance, real external authorization-server integration,
WP6F+, remote or issue/PR mutation, release/publication, Tier qualification,
or Goal completion is claimed.

### WP6E local acceptance closeout

The final sealed rereview package SHA-256 was
`80a9308bf50913f0ee14e0a63c5470f39b736c3287f477db0c2a6b6a3252a1e3`.
The independent reviewer returned **APPROVE: 0 Critical / 0 Important / 0
Minor** with no findings.

The reviewer reproduced evidence HEAD/tree
`83437e95cf7ba9293aeae33ce881d8e8b2a55f70` /
`a38eb3a7e7b258b58d6c853997d5d80544a48e3c`, final code/tree
`6b60f8e95d07167781681c19addddac3140d4d82` /
`c426534260410c3466bc55aef193fbe6e22b8c37`, archive SHA-256
`52a9a5cb05988e2685654105ee30102cbbe6074c9076866151012a791f18285d`,
accepted-WP6D-base cumulative diff
`0cc89ec59a6ce48e20a5e141372f2acbc63525bb2e4f007c706298639f825da1`,
prior-repair-to-final diff
`323762b6573e1b716634e4fbe3411f586abe1a9a23ad701dc850c53d903af3a2`,
amendment-to-final diff
`d2a78c2cf2952c4660f80c81114ce0608752b54ba0f5311c01090dbd3beb1fac`,
and both final RED/GREEN identities and hashes. The tracked tree remained clean
and `git diff --check` passed.

The public exact-principal embedding adapter is exported, returns a safe typed
failure for non-exact or hostile values, rebuilds exact principals through a
fresh canonical snapshot, and is reused by both verifier middleware and the
server compatibility hook. Both private duplicates are removed. All six
original WP6E findings remain resolved.

Independent Node `v22.22.3` and `v24.15.0` verification passed build, the WP6
matrix at 119/119, both protected-resource type fixtures, WP4 HTTP 116/116 plus
three type fixtures, and full `CI=true pnpm run verify` exit 0 including all
WP5 gates and both draft E2E runs.

WP6E is accepted locally. This acceptance does not claim official draft
authorization/client-auth conformance, real external authorization-server
integration, WP6F+, remote or issue/PR mutation, release/publication, Tier
qualification, or Goal completion. Those remain deferred to their prescribed
gates.

## Public authorization-client runtime prerequisite candidate

WP6F stopped before RED at `6cbab50732152afe32406b3a553567130f5e46cc`
because the accepted `auth/client` subpath exposed contracts and low-level
primitives but no public constructor or Layer. The pinned alpha.9 client-auth
fixture also uses HTTP loopback endpoints, which the accepted HTTPS-only
primitives correctly rejected. Coordinator amendment
`7e669ea67660d0d0da61c3a19afc258281106ba0` bounded a prerequisite slice.

The accepted base/tree for this candidate are:

- base commit `7e669ea67660d0d0da61c3a19afc258281106ba0`;
- base tree `3d113344ccd9622f6c0472e922d409a93a049103`;
- code candidate `5bd44dfb574e72331e0b0ddbb6f34edb11eda4f7`;
- code tree `f9ae0063eaa9dd8e9495b2ec5298223a1fc6147c`;
- candidate archive SHA-256
  `09d261c6179fe4dd7d64d2de5b5a9ecb2651ba5d36147098a8ad820a4314ae84`;
- base-to-candidate binary diff SHA-256
  `e3d24a4105f3a5717e38138edb4268707ec1b41b70c4c24a465636ecc3637ad7`.

The authority hashes used for the slice are:

- execution prompt SHA-256
  `8e19ac06cae13d25f8022b36c371067f7b25cee1c0285d0d916c3c0155221864`;
- implementation plan SHA-256
  `376997727c2a11fa5eaa4bed25482a96d21b4387b19272492dd99d13aa77f47b`;
- amended WP6 preflight SHA-256
  `b1bfb0085ac6aa8eb9ccbcb304cbadfa1da1873ca2744cf7d560eaaffead943d`.

### TDD lineage

The fresh implementer committed test-only RED before production. The initial
Node 22 runtime result was 0/6 with every failure caused by the absent public
factory/Layer; build remained green. The strict public type fixture exited 2
only for the absent support types, config, factory, and Layer. Test-only
fixture corrections and coordinator-requested security witnesses remained
separate from production:

| Commit | Kind | Binary diff SHA-256 |
| --- | --- | --- |
| `7ff3a4aac02451a1fdc065521df51b61af7784e0` | initial runtime/type RED | `644e074a62337257ce3b5c1ed22f715e832719a12b933ba962b75081bd408fde` |
| `e8afceffc02ee39d9d5a904f5682e3ad263051a7` | explicit-metadata fixture and hostile URI witnesses | `b480977395b7d682e26bb2993d08f24f65bc93eb6453f75b419dcba401b86227` |
| `6c039b97b6feaa011fa9fc8fa1db013c3b8c5bb9` | construction-failure observation correction | `10f47a4606730c4bad776ded29a5506f3df55fee5670681e86ddd911e0a67bd1` |
| `4a183e2e8032b96edd57641d61e575e55652da01` | exact public export/graph witnesses | `b7522da32e63a0e0d235e8cab67c91c14a23a84301313e56780567b71b02b28d` |
| `7cfe7fdcc862308acebf4ab2b5600a3df3ba40c2` | Layer and failed-refresh witnesses | `56a486fbcbf1d4a86234f817f2c24d5a839a3ee1f6ab32c9194b9943880b2298` |
| `aa5f79bf0ae061998e5f87ab55ac25b4f9463124` | canonical-resource challenge RED | `dc8eca55e8918b8e460eb48ccdf47b797fde15672856239c5ee0104e592bfe08` |
| `bb7cf6884c6ca98b35575278e07264555d0f93fe` | issuer/client and closed-policy RED | `68260bdc6697b167b0241706d4e92181bbbcf6d7b832de535494ef6d887b3c10` |
| `21df9c7498615d5adb86160f1831a9fd4e7a6206` | public runtime and endpoint-policy GREEN | `6dea354499f1559854527cadc3d96fcecd6ea9ac81de87cb5101129f2be09ee0` |
| `dfd6a7c4c1d6f6798dc8101789e6f46a9cda0527` | pre-acquisition mutation-order RED | `548175e27a255da6614a0c020845578e9b5b55a3bc0e6a33cf4b5b8e05cc8d63` |
| `5bd44dfb574e72331e0b0ddbb6f34edb11eda4f7` | pre-acquisition validation GREEN | `e5739387c78e359b386ea049842bd46d58e2785142ddfb207bc01344b3d14756` |

No production edit preceded its relevant RED. The final public runtime captures
the four Effect ports once; binds one client to an exact protected resource;
snapshots bounded config without invoking accessors; deterministically unions
configured, request, prior, and challenge scopes; reuses valid grants; refreshes
or removes expired grants through Effect Clock; and preserves interruption and
typed errors. Prior challenge grants must match the resolved canonical
resource, issuer, and selected client before they can affect scopes or any
credential/DCR mutation. A valid `401 invalid_token` grant is removed before
credential acquisition, token POST, or interaction; a valid `403
insufficient_scope` grant remains stored.

`AuthorizationEndpointPolicy` is the closed value `"https-only" |
"allow-loopback-http"`. HTTPS-only is the default. The opt-in accepts HTTP only
for strict parsed `localhost`, `127.0.0.1`, or `::1` endpoints and rejects
suffixes, alternate IPv4 forms, encoded hosts, userinfo, fragments, and all
non-loopback HTTP. It is explicit through discovery, resolution, registration,
transaction/callback, exchange, and refresh. No ambient or production default
was weakened.

### Changed files and scope

The candidate changes only the authorized client entrypoint, runtime and six
policy-plumbed primitives, focused auth tests, and one public type fixture:

- `src/auth/client.ts`, `src/auth/client/runtime.ts`, `src/auth/client/uri.ts`;
- `src/auth/client/discovery.ts`, `registration.ts`, `resolution.ts`,
  `transaction.ts`, and `token.ts`;
- `test/auth/wp6-client-runtime.test.mjs`, the exact-export and emitted-graph
  witnesses in `wp6b-client-boundary.test.mjs` and `wp6c-security.test.mjs`;
- `test/types/wp6-client-runtime/tsconfig.json` and
  `wp6-client-runtime.ts`.

There is no example, root entrypoint, transport, package manifest/script,
dependency/lockfile, generated source, readiness/governance, external target,
remote, issue, release, or WP7+ change. No secrets or private configuration
were read. Test credentials/tokens are fixed synthetic Redacted fixtures and
never evidence of an external system.

### Final verification

The implementer and coordinator independently passed the exact final code tree
on Node `v22.22.3` and `v24.15.0`:

- build exit 0;
- direct 12-file WP6 auth/runtime/HTTP/package matrix 121/121;
- new `test/types/wp6-client-runtime` fixture exit 0;
- existing `test/types/wp6b-auth-public` fixture exit 0;
- full `CI=true pnpm run verify` exit 0 with loopback permission.

Both full lanes include WP4 HTTP 116/116 plus all three WP4 public type
fixtures, every accepted WP5 gate, and both self-hosted draft E2E executions.
`git diff --check` passed and the tracked worktree was clean. One implementer
diagnostic WP5 attempt inherited Node 25 through nested pnpm and is explicitly
discarded; it is not part of this evidence.

Readiness output remains deliberately blocked on official draft conformance,
release provenance/stable release, published documentation, and agent evidence.
This is a **public authorization-client runtime prerequisite review candidate
only**. WP6F remains paused. No official client-auth or protected-resource
authorization conformance, real external authorization-server integration,
remote/issue/PR mutation, release/publication, Tier qualification, or Goal
completion is claimed.

The sealed candidate-evidence commit is
`8ac8b9b4cda39c54ac5069c22c8cfa6644db9899` with tree
`12d9d252888ac57bddaa939a4c43cf42a2313c85`; its complete `git show
--format=fuller --binary` review-package SHA-256 is
`07726972d7d7dafe7513b728f7a996d05ada83c9e594e5c785b07d705c73951f`.
Independent review must reproduce these identities and inspect code candidate
`5bd44dfb574e72331e0b0ddbb6f34edb11eda4f7` exactly.

### First public runtime independent review

The fresh reviewer reproduced the sealed review HEAD/evidence/code/base commits
and trees, candidate archive, prompt/plan/preflight hashes, review-package hash,
plain-binary cumulative diff, and all ten TDD step digests. The worktree
remained clean. Node 22 and Node 24 builds and both public runtime type fixtures
passed; fresh Node 22 full `CI=true pnpm run verify` passed. Those green gates
do not accept the candidate.

The verdict was **REQUEST CHANGES: 0 Critical / 5 Important / 0 Minor**:

1. the claimed 12-file 121/121 matrix named a nonexistent package file; the
   real `wp6b-auth-subpaths.test.mjs` made the result 123/125 on both runtimes,
   with stale exact public/tarball export expectations;
2. the runtime rejected a standards-valid initial 401 Bearer challenge without
   `error`, even though the transport and pinned flow accept it;
3. pre-merging challenge scopes erased the accepted present-empty versus absent
   distinction and could incorrectly fall back to metadata scopes;
4. eager discovery could block a valid grant on AS outage and prevent the
   normative initial unauthenticated request or later reuse after a non-default
   explicit metadata challenge;
5. runtime canonical parent-resource grants were rejected by the transport's
   raw protected-resource equality check.

The package omission invalidates the reported candidate matrix, and all four
behavioral seams are release-relevant. Candidate `5bd44df` and package
`9586841` are rejected. No official conformance, external authorization-server,
remote, issue/PR, release, Tier, or Goal mutation was performed.

## Public authorization-client runtime independent-review repair candidate

The coordinator bounded the five Important findings in amendment
`bd887b7df7f4c73f9ba4e7d07d384d83635f806c` / tree
`a9e258c4452fa4586453babaa7543fba4ba66204`. The public optional challenge
scope then exposed one compile-only consumer in the protected-resource
serializer; coordinator amendment
`253ae2399226a5a60a0d50b247d71aadb6c5bb53` / tree
`fea6eece9d7febd97de5a8fcdfc4d206ee888a0b` authorized only the minimal
undefined guard in that serializer.

### TDD lineage and immutable identities

Fresh test-only RED commit
`d53362ccbb11269dc225a6c0ba790bb10b03bfc5` / tree
`c2c734c9d55ca311ccd24b1f00f6c19aa26587dd` changed only the four authorized
test/type files. Its binary diff SHA-256 from the repair amendment is
`0360aa4780e77beed30f64d7bf3d6b766485fe21ac8c78103dca493ae281b286`.

Exact Node `v22.22.3` RED evidence:

- the direct runtime, HTTP, and real package/tarball command ran 27 tests:
  21 passed and six intended behavioral tests failed for deferred AS
  discovery, no-error 401 handling, optional challenge scope, missing default
  metadata plus explicit-metadata memory, scope-presence transport parsing,
  and canonical-parent transport acceptance;
- the real `test/packaging/wp6b-auth-subpaths.test.mjs` passed 4/4 after its
  exact public and packed-consumer factory/Layer expectations were corrected;
- `pnpm exec tsc -p test/types/wp6-client-runtime/tsconfig.json` exited 2 only
  because constructing a challenge without `scopes` was still rejected.

After the production repair made the present-empty challenge reach the token
exchange boundary, the accepted token decoder correctly rejected the test
fixture's synthetic `scope: ""`. Test-only normalization
`5b6acb335b439730c246c198df829c1f7713651a` / tree
`612fcb40cdf3110aff463de386bad312e3f800e1` omitted the token response `scope`
only for that empty-scope case, matching the protocol shape. It did not change
or weaken any RED assertion. Its binary diff SHA-256 from the scope amendment
is `a4a296823edbdaa3c923b09fc97cc604ed8f6ce33dfa757b0ab7385ee661463e`.

Production GREEN commit
`5cd6c3e73d50d20deeade7379e6e58ed9a09db88` / tree
`322b12a9d6e65573c7e2b5ff4349212b2644009d` has binary diff SHA-256
`eabea84e5a099d98a2a901fe755eeeccac068ec7f6600df68cf6dff004de3e58`
from the normalized RED boundary. The complete repair-amendment-to-GREEN
binary diff SHA-256 is
`b6e1fb20742344a8c894c06cdcf116b0a14e329e9cc69c686d90433f58d5ba86`.
The GREEN candidate archive SHA-256 is
`a2274f5adeb59bb7a26e7ee50ef5ae37701160bb1c60a80a02c2cc61d8408779`.

All four repair diff digests above hash the literal output of
`git diff --binary --full-index --no-ext-diff --no-textconv <base>..<head>`.
The explicit full-index form is part of the evidence algorithm; a plain
`git diff --binary` abbreviates blob indices and therefore produces different
bytes despite representing the same patch.

### Repaired behavior

- `AuthorizationChallenge.scopes` is optional. The HTTP parser omits it when
  the challenge has no `scope` attribute and retains an owned empty set for
  `scope=""`. Runtime orchestration passes it separately to the accepted
  resolver, so absent permits metadata fallback and present-empty suppresses
  that fallback.
- A `401 Bearer` challenge accepts absent `error` or `invalid_token`; either
  path validates and removes a prior rejected grant before credential
  creation, DCR, token POST, or user interaction. `403` remains restricted to
  `insufficient_scope` and retains a valid prior grant.
- `currentGrant` no longer discovers authorization-server metadata for a valid
  grant. It discovers that metadata only for an expired refreshable grant.
  Exhausted all-404 default protected-resource discovery yields `None`, while
  malformed, mismatched, unsafe, non-404, and remembered-explicit failures
  remain typed fail-closed errors.
- A successfully audience-validated exchange through explicit
  `resource_metadata` records that validated URI in one internal Effect `Ref`.
  Later lookup uses the explicit URI; it is not recorded before successful
  exchange.
- Streamable HTTP validates a stored grant through the existing strict URI
  parser and `isSameOriginPathParent`, accepting an exact same-origin canonical
  path parent while rejecting cross-origin, siblings, queries, fragments,
  malformed values, and userinfo before exposing a Bearer value.
- The actual package and tarball witness now requires the two public runtime
  functions in the exact auth-client export set and observes both functions in
  a packed consumer.

### Scope audit

The complete repair changed only:

- `src/auth/common.ts`;
- `src/auth/client/runtime.ts`;
- `src/transport/StreamableHttpClientTransport.ts`;
- the separately amended two-line optional-scope guard in
  `src/auth/protected-resource/services.ts`;
- `test/auth/wp6-client-runtime.test.mjs`;
- `test/http/wp6-http-client-auth.test.mjs`;
- `test/packaging/wp6b-auth-subpaths.test.mjs`;
- `test/types/wp6-client-runtime/wp6-client-runtime.ts`;
- the two coordinator-owned preflight amendments and this evidence report.

There is no example, root entrypoint, package manifest/script,
dependency/lockfile, generated source, readiness/governance, external target,
remote, issue, release, or WP7+ change. No secret or private configuration was
read or written.

### Fresh dual-runtime verification

Node `v22.22.3`, pnpm `10.11.1`:

- `CI=true pnpm run build`: exit 0;
- corrected direct 12-file matrix, explicitly including
  `test/packaging/wp6b-auth-subpaths.test.mjs`: 131/131;
- `pnpm exec tsc -p test/types/wp6-client-runtime/tsconfig.json`: exit 0;
- `pnpm exec tsc -p test/types/wp6b-auth-public/tsconfig.json`: exit 0;
- `pnpm exec tsc -p test/types/wp6-auth-protected-resource/tsconfig.json`:
  exit 0;
- `CI=true pnpm run test:wp4-http`: 116/116 plus all three WP4 public type
  fixtures under bounded loopback permission;
- `CI=true pnpm run test:wp5-core`: exit 0 across all ten aliases;
- `CI=true pnpm run verify`: exit 0 under bounded loopback permission.

The first restricted WP4 diagnostic was 114/116 solely because its two real
listeners received `listen EPERM 127.0.0.1`; it was not counted as behavioral
evidence. The unchanged command then passed 116/116 with the required bounded
permission.

Node `v24.15.0`, pnpm `10.11.1`:

- `CI=true pnpm run build`: exit 0;
- the same corrected direct matrix: 131/131;
- all three WP6 type fixtures above: exit 0;
- `CI=true pnpm run test:wp4-http`: 116/116 plus three type fixtures;
- `CI=true pnpm run test:wp5-core`: exit 0 across all ten aliases;
- `CI=true pnpm run verify`: exit 0 under bounded loopback permission.

Both full verification lanes include every accepted WP2-WP5 package-health
gate and both self-hosted draft E2E executions. This evidence is a fresh
independent-review repair candidate only. It does not claim official
client-auth conformance, real external authorization-server integration,
WP6F completion, issue/PR disposition, release/publication, Tier
qualification, or Goal completion. A new immutable package and fresh
independent review must replace the rejected candidate evidence.

The replacement candidate-evidence commit is
`b5b09e4a262bdd0e547a2bdd06d6e80769c5fbc4` with tree
`30e95fcb2994636f01d2debecfe8ce462f90290a`; its complete `git show
--format=fuller --binary` SHA-256 is
`7f32fa7664051f0937d9db8f28a1fd2d567a70f8d8221c7f2285634911333a21`.
The evidence-report commit immediately before the reproducibility amendment is
`607e98479d87203529d006e402a3ffbb0475f2b3`, whose complete `git show
--format=fuller --binary` SHA-256 is
`cd440174d6318a2e27ca6725fe72ad84a03c06236a608d7c8071483ff07706b3`.
Independent review must reproduce these identities and inspect production
candidate `5cd6c3e73d50d20deeade7379e6e58ed9a09db88` exactly.

### Replacement runtime review and coordinator acceptance

A fresh independent reviewer inspected sealed package `94963d8`, reproduced
every commit/tree, the four full-index diff digests, candidate archive, both
evidence `git show` digests, the TDD sequence, changed-file scope, and a clean
worktree. The verdict was **APPROVE: 0 Critical / 0 Important / 0 Minor**.

Fresh reviewer verification passed the Node `v22.22.3` build, corrected real
12-file matrix at 131/131, all three WP6 type fixtures, and complete
loopback-permitted `CI=true pnpm run verify` including WP4 HTTP 116/116 and
both self-hosted draft E2E runs. Node `v24.15.0` build, corrected matrix
131/131, and all three WP6 type fixtures also passed. The restricted Node 22
diagnostic with two listener `EPERM` failures and an accidental ambient Node
25 diagnostic were discarded and are not acceptance evidence.

The coordinator accepts production candidate
`5cd6c3e73d50d20deeade7379e6e58ed9a09db88` as the public
`AuthorizationClient` runtime prerequisite. This acceptance authorizes WP6F
to resume. It does not claim official client-auth conformance, external
authorization-server integration, WP6 completion, release readiness,
publication, Tier qualification, or Goal completion.

## WP6F authorization delivery and conformance-repair candidate

WP6F resumed from accepted runtime-prerequisite record
`50f4d04be0db107bf6a934d2ab955166965c69ad` / tree
`826545772b9e9a8e90e12f5150728e9b27a196e8`. The production candidate is
`497e71318b8b24f6edfbd79e8edefb43fb7352dd` / tree
`9e309398fafb8b44b8a9d6dc6d58ee7929215b7c`.

### TDD and correction lineage

The original delivery RED/GREEN pair is `958a9de` / `a326d19`, separated only
by the approved core-catalog compile migration `c3b6358`. The official
alpha.9 harness then exposed and bounded the following corrections:

- DCR public-client compatibility: amendment `4704f20`, RED `952a4d6`, GREEN
  `6d96fa3`;
- stale root witness: amendment `7ed656c`, correction `4ec00d9`;
- parity/readiness exactness: amendment `b80351b`, RED `e84fb3c`, GREEN
  `bd06f33`;
- WP4 and WP5 ledger witnesses: amendments `95c968d` and `e2f0fe7`,
  corrections `6d0cd8f` and `3126b2e`;
- remembered-grant step-up: amendment `0864f70`, RED `d208259`, test witness
  corrections `25ba398` and `047fb9c`, GREEN `75e9318`;
- post-review lifecycle cleanup: RED `a2e8439`, final GREEN `497e713`.

The corrected RED at `a2e8439` built successfully and ran 13 focused runtime
tests: 11 passed and exactly two intended assertions failed. They proved that
an expired remembered grant lacking a newly requested scope was not removed,
and that a hostile post-save grant snapshot survived the typed validation
failure. Final GREEN made the same suite 13/13. No production edit preceded
its corresponding behavioral witness.

### Delivered behavior and scope

- The root legacy OAuth namespaces are removed without a shim. The stable
  `auth/client` and `auth/protected-resource` subpaths, public Everything
  examples, package aliases, governance, migration, parity, and readiness
  accounting are the authoritative WP6 surfaces.
- DCR discards an unsolicited secret only for a method-omitted public-client
  response resolved as `none`; an explicit incompatible method/secret pair
  still fails closed.
- A validated remembered grant prevents metadata fallback from broadening a
  request. Every remembered handle is reread, binding-checked, and expiry-
  checked with Effect Clock before scope suitability. Invalid-token,
  unrefreshable expiry, failed refresh, and invalid post-save validation remove
  the affected grant without exposing token material.
- The official step-up flow retains the initial `mcp:basic` grant, unions the
  later `mcp:write` challenge, and completes without multiplying transport or
  HeaderMismatch recovery budgets.
- Readiness and parity now account issue #20 as locally implemented while
  retaining remote disposition, release, documentation, external-AS, and Tier
  gates.

The complete base-to-code inventory contains only the approved WP6F docs,
scripts, examples, auth runtime/registration sources, root removal, focused
auth/package governance tests, and the task-6 preflight amendments. It adds no
production or development dependency, changes no lockfile or generated MCP
source, and does not include the separately preserved `visual-effect` clone or
language-service changes in the main checkout.

### Fresh dual-runtime verification

Exact Node `v22.22.3`, pnpm `10.11.1`:

- build exit 0;
- `test:wp6-auth-client`: 90/90;
- all three WP6 public type fixtures: exit 0;
- cumulative `test:wp6`: 90 client + 19 protected-resource + 23 HTTP + 15
  package = 147/147, plus all three type fixtures;
- complete loopback-permitted `CI=true pnpm run verify`: exit 0, including
  WP4 HTTP 116/116 and both self-hosted draft E2E executions;
- official `conformance:client-auth`: exit 0, pinned
  `@modelcontextprotocol/conformance@0.2.0-alpha.9`, literal spec version
  `2026-07-28`, 14 scenarios, 247 CLI assertions passed, zero failed, zero
  warnings. The machine-readable artifact records 598 check events, zero
  failures, and zero warnings at
  `.local/conformance/client-auth-2026-07-20T19-42-48-977Z`.

Exact Node `v24.15.0`, pnpm `10.11.1`:

- build exit 0;
- `test:wp6-auth-client`: 90/90;
- all three WP6 public type fixtures: exit 0;
- cumulative `test:wp6`: the same 147/147 plus type fixtures;
- complete loopback-permitted `CI=true pnpm run verify`: exit 0, including
  WP4 HTTP 116/116 and both self-hosted draft E2E executions;
- official `conformance:client-auth`: exit 0 with the same pinned version,
  literal spec version, 14 scenarios, 247 CLI assertions passed, zero failed,
  and zero conformance warnings. The machine artifact records 598 check
  events, zero failures, and zero warnings at
  `.local/conformance/client-auth-2026-07-20T19-43-10-538Z`.

Node 24 emitted process deprecation `DEP0190` from the pinned conformance
harness starting its child with `shell: true`. It is classified as an upstream
harness/tooling warning: the SDK client command, all scenarios, and the
machine-readable conformance result remained green with zero warnings. The
restricted Node 22 diagnostic that produced only two `listen EPERM` failures
was discarded; the exact unchanged command passed WP4 HTTP 116/116 with the
required bounded loopback permission.

The expected nonzero example-client exit inside `scope-retry-limit` is the
negative scenario's asserted behavior, not a suite failure. Both harness lanes
accepted it and exited zero.

### Retained blockers and review gate

`conformance:authorization` was not run because no coordinator-approved real
external authorization-server target or safe configuration exists. This
explicitly blocks protected-resource external qualification and any release or
Tier claim; no simulated issuer substitutes for that gate.

The candidate worktree is clean and `git diff --check` passes. This remains a
WP6F/WP6 independent-review candidate only. It does not approve WP6, mutate a
remote/issue/PR, release or publish, qualify Tier 1, or complete the Goal. A
fresh immutable review must reproduce the sealed identities and return zero
Critical and zero Important findings before coordinator acceptance.

### Immutable review package inputs

The evidence-report commit is
`9be1af52991b4e42f63f0fdb3f51f081d5c4d606` / tree
`d64d643277bd346f6a32d765929a0547add2c670`. Its complete `git show
--format=fuller --binary` SHA-256 is
`89d76a377fad7808d70c0425e60888aca68bc820ca2449224f73b32f047edf04`.

For the production candidate `497e71318b8b24f6edfbd79e8edefb43fb7352dd`:

- the complete `git show --format=fuller --binary` SHA-256 is
  `63e836abf48ea3d6506af312208224e3449b303b3107677de347978b86a0850b`;
- the literal full-index binary diff from accepted base `50f4d04` has SHA-256
  `3775de402023c45a6173e52dcd5618e480b9f0813416f073c3d3c58cc791b250`;
- `git archive --format=tar 497e713` has SHA-256
  `57216428a6f1e9b8c14f03640a03babe7c30c67cf0fe9eb5d571f7fab5b1dfb2`.

At evidence commit `9be1af5`, the authoritative execution prompt, complete
implementation plan, and WP6 preflight SHA-256 values are respectively:

- `8e19ac06cae13d25f8022b36c371067f7b25cee1c0285d0d916c3c0155221864`;
- `376997727c2a11fa5eaa4bed25482a96d21b4387b19272492dd99d13aa77f47b`;
- `dafc8cc528facb07e12e16248c62ce03c2f09003fa73650f7bec4e294d1517b8`.

Review must inspect the ordered `50f4d04..497e713` commit sequence, reproduce
these identities and hashes, inspect both local client-auth artifact trees,
confirm `git diff --check` plus clean status, and review production behavior
rather than accepting green gates alone.

## WP6F fail-closed conformance-evidence repair candidate

Fresh review of sealed candidate `330de22` rejected the package with **0
Critical / 2 Important / 1 Minor**. The production authorization behavior and
both official client-auth runs were green, but the preserved evidence had
empty requirement mappings, no runtime provenance, one overwritable readiness
path, no artifact-local runtime manifest, and no safe provenance for a
configured external authorization target. Warning classification was also
tautological. The rejected package is retained as history and is not an
accepted WP6 candidate.

Coordinator amendment `23b013f3fafbb3829597207d8582ec944f28f9fc`
prohibited that state and bounded the repair to conformance evidence producers,
their governance witness, and coordinator records. Tests-only RED commit
`818f39df49bb6bc714dd104dfa65a9141330d4d7` / tree
`f3bcc065d4552865999c4a31e857c5a0defb6daf` failed exactly three intended
boundaries: the evidence constructor/validator did not exist, per-runtime pass
enforcement did not exist, and configured authorization target mode was
absent. Its complete `git show --format=fuller --binary` SHA-256 is
`ca0ffe49ce392a74c5b4929c50caa94ee4cbddcffc6f12ac86b088c890478a60`.

Production GREEN commit
`f987a74356c12fe19695175f492873fce899abf9` / tree
`fa4b470b8e3fdc344d74e36a3bce5fd8dd7cc0e6` makes evidence validity a
precondition of command success:

- every requirement ID must be non-empty and present in the authoritative
  readiness registry;
- the recorded Node version must equal the live runtime, pnpm must equal both
  the live package-manager user agent and the exact repository pin, and MCP
  core/conformance revisions must equal `sources/manifest.json`;
- a successful command requires at least one scenario and check, zero failures,
  and zero warnings; every unadjudicated conformance warning is explicitly
  blocking;
- client-auth readiness files include the exact Node version, so Node 22 and
  Node 24 cannot overwrite one another;
- every conformance artifact tree receives an exact `evidence.json` manifest;
- authorization evidence requires exactly one safe target field whose value is
  `missing`, `settings-file`, or `url`; no path, URL, client identity, secret,
  token, or callback value is retained;
- the server, client-auth, and external-authorization producers all exit
  nonzero when the shared evidence predicate is not satisfied.

The static conformance governance checker now requires these shared markers.
No dependency, lockfile, generated source, authorization runtime/transport,
public SDK surface, example, external target, remote, issue, release, Tier,
Tasks, Apps, Visual Effect, or language-service change is included.

### Replacement verification and machine evidence

Exact Node `v22.22.3`, pnpm `10.11.1`:

- focused governance/evidence witnesses: 11/11;
- build and cumulative `test:wp6`: exit 0, including 147/147 runtime/package
  tests and all three public type fixtures;
- complete loopback-permitted `CI=true pnpm run verify`: exit 0, including WP4
  HTTP 116/116 and both self-hosted draft E2E executions;
- official pinned `conformance:client-auth`: exit 0, 14 scenarios, 247 CLI
  assertions passed, zero failed, zero warnings, and 598 machine check events.

Its readiness artifact is
`.local/readiness-evidence/conformance-client-auth-node-v22.22.3.json` with
SHA-256 `1b224a9f1e7a7d04d2b77463098df60e9f06005f417281d06b0c2e4f43175c97`.
It exactly equals
`.local/conformance/client-auth-2026-07-20T20-10-07-276Z/evidence.json` and
records Node `v22.22.3`, pnpm `10.11.1`, `GR-CONF-001`, MCP-core revision
`26897cc322f356487da89113451bd16b520b9288`, and conformance revision
`ce25103b1baa6e0653e0b7bf4f79de385ea7a116`. The sorted per-file SHA-256
manifest digest for that artifact tree is
`a15e9677c36ab4adb8d833259e4b4765a9537d4237c51f9b1f855bf65693293d`.

Exact Node `v24.15.0`, pnpm `10.11.1`:

- the same focused witnesses, build, cumulative `test:wp6`, and all type
  fixtures pass;
- complete loopback-permitted `CI=true pnpm run verify`: exit 0 with the same
  WP4 and E2E coverage;
- official pinned `conformance:client-auth`: exit 0 with the same 14 scenarios,
  247 CLI passes, zero failures, zero warnings, and 598 machine check events.

Its distinct readiness artifact is
`.local/readiness-evidence/conformance-client-auth-node-v24.15.0.json` with
SHA-256 `fe5ad90ca7cc839c7efa5a2995be308a6636af8567cf0a4c785ba5fa92e968cc`.
It exactly equals
`.local/conformance/client-auth-2026-07-20T20-10-19-488Z/evidence.json` and
records Node `v24.15.0` with the same exact pnpm, requirement, and pinned-source
contract. The sorted per-file SHA-256 manifest digest for that artifact tree is
`01875adeb3014e37c3d6933eb3f882e7ff6a1a9007e6d7330c10d58df069c7fe`.

Node 24 again emitted process deprecation `DEP0190` from the pinned harness's
`shell: true` child-process implementation. It is upstream tooling output, not
a conformance check; the machine report contains zero warning events. The
expected nonzero example-client exit inside `scope-retry-limit` remains the
negative scenario's asserted behavior and the official suite accepts it.

`conformance:authorization` remains unrun because no coordinator-approved real
external authorization-server target or safe configuration exists. The new
missing-target artifact is complete and fail-closed, but it is not external-AS
qualification. This continues to block protected-resource external
qualification and any release or Tier claim.

### Replacement immutable code identities

For production candidate `f987a74356c12fe19695175f492873fce899abf9`:

- complete `git show --format=fuller --binary` SHA-256:
  `418cb0ed68fb8988a89f47f6eb4561be3145424e79c41766b4725efca51895a7`;
- literal full-index binary diff from accepted runtime base `50f4d04` SHA-256:
  `1e7d3b154d3a3145aa8f73997704fc91b40e99b01ee3716770ccbcf217a5629e`;
- `git archive --format=tar f987a74` SHA-256:
  `c4ecb71fede246e0b110463fda5fac75513e5612f415841978fd69b13ea549d4`.

At this report, the authoritative execution prompt, complete implementation
plan, and amended WP6 preflight SHA-256 values are respectively:

- `8e19ac06cae13d25f8022b36c371067f7b25cee1c0285d0d916c3c0155221864`;
- `376997727c2a11fa5eaa4bed25482a96d21b4387b19272492dd99d13aa77f47b`;
- `f1ead6ae1eb4343c250639c1c2c40e67278b0ae70955ad0aea9b99d30dea49c5`.

This is a fresh independent-review candidate only. Review must inspect
`23b013f..f987a74`, reproduce all identities and evidence manifests, confirm a
clean worktree and `git diff --check`, and return zero Critical and zero
Important findings before WP6 acceptance. It does not approve WP6, mutate a
remote/issue/PR, release or publish, qualify Tier 1, or complete the Goal.

### Sealed replacement review package

The evidence-report commit is
`478ad1bba66e8a3ca27e21b9d6c20b880b776f8f` / tree
`f5f781353d8cdd8f349ea07d00cf131677a1157c`. Its complete `git show
--format=fuller --binary` SHA-256 is
`210b4ecf1a2a0a2f9d175a1c9da8f4bdc540efab999aa3f76a5a19dd4c72c906`.

At evidence commit `478ad1b`:

- the literal full-index binary diff from accepted runtime base `50f4d04` has
  SHA-256
  `a5af947517aa370ec82818ab2b4212cad5e0f565a1b1df69a02cf07cfad892ec`;
- `git archive --format=tar 478ad1b` has SHA-256
  `e90788d55665a862039c1364bc379ec3b8de8a68dfd35531e8a9320f5370c059`.

Fresh review must treat this sealed package as replacing rejected package
`330de22`, reproduce the code and evidence identities above, inspect the local
artifact manifests rather than relying on prose, and review the fail-closed
behavior itself. The coordinator will not accept WP6 unless that review returns
zero Critical and zero Important findings.

## WP6F adversarial evidence-publication repair candidate

Fresh independent review of sealed package `03a5217` returned **REQUEST
CHANGES: 0 Critical / 4 Important / 0 Minor**. Although its preserved Node 22
and Node 24 artifacts reproduced exactly and were complete, the shared
constructor counted unknown and skipped check statuses as passes, accepted a
registry-real but suite-inappropriate requirement ID, and wrote readiness
before the artifact-local manifest. Fault injection therefore left a
successful-looking readiness file after manifest publication failed. The
reviewer also found that two strengthened assertions had first appeared in the
rejected production GREEN instead of its committed RED. Package `03a5217`
remains rejected and is not accepted as WP6 evidence.

Coordinator amendment
`5ac348f5ae3e6bfee92fe6473119cbe6b406a48` starts a new, non-rewritten repair
lineage from that rejected package. Tests-only RED commit
`b08b3ccc1daed7b3fc6568111213f60bfc915019` / tree
`a3140d3d45ff9a97367d730f380d6ed4b8183d54` produced 11 passes and exactly
three intended failures:

1. unknown/skipped/missing statuses and an empty scenario check set did not
   fail construction;
2. registry-real `GR-TEST-002` was accepted as conformance evidence;
3. forced `EISDIR` at artifact-manifest publication left a readiness file.

Its complete `git show --format=fuller --binary` SHA-256 is
`db37dfdf709aaf30a9d046f12747e377a615af4fa9c2e7d0d13b931ca41c86eb`.
No production file changed before this RED commit.

Production GREEN commit
`202ead5ba6b3688bbb7cf9e992cd76f1e8376b54` / tree
`c1ac84c7a5767f8a6174e54240093a6f38fd6fbe` closes all three bypasses:

- every scenario has a non-empty check array, every check has a non-empty ID
  and name, and the only accepted statuses are `SUCCESS`, `INFO`, `WARNING`,
  and `FAILURE`; `SKIPPED`, unknown, and malformed statuses fail construction;
- conformance reports require exactly the registry-real, suite-appropriate
  `GR-CONF-001` mapping rather than arbitrary registry membership;
- the exact serialized report is staged at both destinations; the
  artifact-local manifest is atomically replaced and byte-verified first;
  readiness is atomically replaced and byte-verified last; temporary siblings
  are removed on every exit;
- a failure at the manifest destination publishes no new readiness file, and a
  failure at readiness leaves only the already-complete artifact manifest;
- the static governance checker requires the closed status set, exact mapping,
  and manifest-first/readiness-last publication order.

The production delta modifies only the already-authorized shared evidence
writer and static checker. It adds no dependency, lockfile, generated source,
authorization runtime/transport behavior, example, public SDK API, external
target, remote, issue, release, Tier, WP7+, Tasks, Apps, Visual Effect, or
language-service change.

### Adversarial and dual-runtime verification

On exact Node `v22.22.3` and Node `v24.15.0`, each with pnpm `10.11.1`:

- focused governance/evidence suite: 14/14, including both destination fault
  fixtures and all closed-status/mapping adversaries;
- static conformance checker: pass;
- cumulative `test:wp6`: exit 0 (90 client, 19 protected-resource, 23 HTTP,
  and 21 package tests, plus all three public type fixtures);
- complete loopback-permitted `CI=true pnpm run verify`: exit 0, including WP4
  HTTP 116/116 and both self-hosted draft E2E executions;
- official pinned `conformance:client-auth`: exit 0, 14 scenarios, 247 CLI
  assertions passed, zero failed, zero warnings, and 598 machine events.

The new Node 22 readiness artifact is
`.local/readiness-evidence/conformance-client-auth-node-v22.22.3.json` with
SHA-256 `56aa750f7d841b257f1fc43b495e514798c3b2e4a1e63449ed34345b5ecc3167`.
It byte-matches
`.local/conformance/client-auth-2026-07-20T20-31-34-791Z/evidence.json`.
The artifact contains 247 `SUCCESS`, 351 `INFO`, and no other check statuses;
its sorted per-file SHA-256 manifest digest is
`7e4a8a0665db64849427bb3447fafc73e31054b0a65bf7704ad1d5a57633ef9e`.

The distinct Node 24 readiness artifact is
`.local/readiness-evidence/conformance-client-auth-node-v24.15.0.json` with
SHA-256 `7357574d0c59379f2590d8cd5b19eab8e3a705a631de3b611fc07510a1ce283c`.
It byte-matches
`.local/conformance/client-auth-2026-07-20T20-31-50-400Z/evidence.json` and has
the same closed 247 `SUCCESS` / 351 `INFO` status inventory. Its sorted
per-file SHA-256 manifest digest is
`61cbe0ae238446b265b37ae0f85dad49d0cfa0c785c99a11db2926bee1ed30d6`.

Both reports independently record their exact Node runtime, pnpm `10.11.1`,
`GR-CONF-001`, MCP-core revision
`26897cc322f356487da89113451bd16b520b9288`, conformance revision
`ce25103b1baa6e0653e0b7bf4f79de385ea7a116`, 14 scenarios, 598 checks, zero
failures, and zero warnings. No staged `.tmp` evidence file remains. Node 24's
unchanged `DEP0190` output remains pinned-harness `shell: true` tooling output,
not a conformance check event.

`conformance:authorization` remains unrun because no coordinator-approved real
external target or safe configuration exists. This continues to block
external protected-resource qualification and all release/Tier claims; no
fixture substitutes for that gate.

### Adversarial repair immutable identities

For production GREEN `202ead5ba6b3688bbb7cf9e992cd76f1e8376b54`:

- complete `git show --format=fuller --binary` SHA-256:
  `4933d48b9d493b0e7622072c006fe7adf68f6f0ef169d8674002c25643cc572f`;
- literal full-index binary repair diff from rejected `03a5217` SHA-256:
  `86fd07807fa59220ecba521b69f0b54e4a931288c01590b9fa0ad60610951a91`;
- literal full-index binary diff from accepted runtime base `50f4d04`
  SHA-256:
  `32ca4cf6abb887a9f170bf9acab3290e047010777a29015fcfb4b3a4fcf0b9a8`;
- `git archive --format=tar 202ead5` SHA-256:
  `1f84f0797d56280af1d08fe4d103ad69361fe03f14a99260a6c4805ed162104b`.

The current authoritative prompt, plan, and twice-amended WP6 preflight
SHA-256 values are respectively:

- `8e19ac06cae13d25f8022b36c371067f7b25cee1c0285d0d916c3c0155221864`;
- `376997727c2a11fa5eaa4bed25482a96d21b4387b19272492dd99d13aa77f47b`;
- `bee3ee2130b5f1be9cad75788e753ba3ade8729687119e8c692396958ffbed09`.

This remains an independent-review candidate only. Fresh review must inspect
the actual `03a5217..202ead5` repair lineage and both artifact trees, reproduce
all identities, rerun adversarial witnesses, confirm a clean worktree and
`git diff --check`, and return zero Critical and zero Important findings before
WP6 acceptance. It does not approve WP6, mutate a remote/issue/PR, release or
publish, qualify Tier 1, or complete the Goal.

### Sealed adversarial replacement package

The evidence-report commit is
`82bce5e299cd909e4d7359e4517b8eab0b7d761d` / tree
`b6af587ecd042573ed66388f055b69a0a4840321`. Its complete `git show
--format=fuller --binary` SHA-256 is
`aec962192bdd289ec052078e0ccf27a51f9e7b6e96c9f0809ff4987886fbfc86`.

At evidence commit `82bce5e`:

- the complete repair diff from rejected package `03a5217` has SHA-256
  `b5d8a48a708856e36f8af36b0723fa9ca07bb7b8ff4e024a8505bac7de60cbe8`;
- `git archive --format=tar 82bce5e` has SHA-256
  `a4cb0d06bd0fc8324c97aa715068e26b2f898054e11113748b71244365da090a`.

This sealed package replaces rejected packages `330de22` and `03a5217`.
Review must reproduce the identities and adversarial behavior rather than
accepting the report narrative. WP6 remains unaccepted until that review
returns zero Critical and zero Important findings.

## WP6F authorization-output and final-scenario repair candidate

Fresh independent review of sealed package `ca535f5` returned **REQUEST
CHANGES: 0 Critical / 2 Important / 0 Minor**. The production authorization
behavior and preserved dual-runtime client-auth evidence remained green, but
the configured external-authorization runner inherited child stdout and stderr,
so a target command could echo its settings path, target URL, client ID, client
secret, or port into the coordinator's logs. The final-report validator also
accepted shallow scenario objects whose identity, shape, status, or aggregates
did not agree with the check inventory. Package `ca535f5` remains rejected and
is not accepted as WP6 evidence.

Coordinator amendment
`5439ea4d57c2245f59e3a4b525acc29b9ef85a57` makes complete, non-leaking
machine-readable evidence an invariant rather than a best-effort property.
Tests-only RED commit
`bde4f5646d5e0aef7cb33c6214f39f4c378cef96` / tree
`750c09a41143b4524abe0b333f02bfe0408006ce` demonstrated the two independent
bypasses before production changed:

1. seven independently mutated final-scenario reports were accepted despite a
   missing exact shape, `SKIPPED` or unknown status, status/count inconsistency,
   aggregate mismatch, an extra field, or duplicate identity; and
2. a configured external-authorization fixture echoed every sensitive runtime
   value across stdout and stderr, including values split at stream chunk
   boundaries, and those values remained observable.

The ordinary governance witnesses still passed in RED; the seven nested
scenario-corruption witnesses and the configured-output-leak witness failed as
intended. Its complete `git show --format=fuller --binary` SHA-256 is
`f4195605ba8737a6ac262427564968718afb537e512a62eaf11d92d2534de8fc`.
No production file changed before this RED commit.

Production GREEN commit
`b7f6a6a00f4c29627fbafe080bcd0e213fd69378` / tree
`365487ba5da0aadbe357c560e83773672873e7fe` closes both bypasses:

- every final scenario must have exactly `id`, `scenario`, `checkCount`,
  `failureCount`, `warningCount`, and `status`; identity is non-empty,
  identical across `id` and `scenario`, and unique; counts are non-negative,
  checks are positive, failure plus warning counts cannot exceed checks, and
  status must be the exact derived `pass`, `warning`, or `fail` value;
- scenario totals must exactly reproduce the report-level scenario, check,
  failure, and warning aggregates, so a successful report cannot be published
  from internally inconsistent summary data;
- configured authorization children use piped stdout and stderr with a
  chunk-boundary-safe streaming redactor based on `StringDecoder`; the settings
  file path or direct URL, client ID, client secret, and port are replaced with
  `[REDACTED]` before output reaches coordinator streams;
- safe child output remains observable, both output streams are handled, and
  the implementation does not buffer the complete child output in memory;
- the static governance checker requires the exact scenario validator and
  streaming-redaction controls.

The production delta changes only
`scripts/readiness-evidence.mjs`,
`scripts/run-conformance-authorization.mjs`, and
`scripts/check-conformance-evidence.mjs`. It adds no dependency, lockfile,
authorization runtime/transport behavior, public SDK API, external target,
remote, issue, release, Tier, WP7+, Tasks, Apps, Visual Effect, or
language-service change.

### Final adversarial and dual-runtime verification

On exact Node `v22.22.3` and Node `v24.15.0`, each with pnpm `10.11.1`:

- focused governance/evidence suite: 22/22 including all seven independent
  final-scenario mutations, both-destination publication faults, closed-status
  and requirement-mapping adversaries, and configured-output redaction;
- static conformance-evidence checker: pass;
- cumulative `test:wp6`: exit 0 (90 client, 19 protected-resource, 23 HTTP,
  and 29 package TAP tests including nested scenario subtests, plus all three
  public type fixtures);
- complete loopback-permitted `CI=true pnpm run verify`: exit 0, including WP4
  HTTP 116/116 and both self-hosted draft E2E executions;
- official pinned `conformance:client-auth`: exit 0, 14 scenarios, 247 CLI
  assertions passed, zero failed, zero warnings, and 598 machine events.

The new Node 22 readiness artifact is
`.local/readiness-evidence/conformance-client-auth-node-v22.22.3.json` with
SHA-256 `6770e0eb2c2ec987c019fa4053a287b1784dc32694b9d5967a5a792d6e3d47de`.
It byte-matches
`.local/conformance/client-auth-2026-07-20T20-54-10-170Z/evidence.json`.
The artifact contains 247 `SUCCESS`, 351 `INFO`, and no other check statuses;
its sorted per-file SHA-256 manifest digest is
`4b20ac4c9a6089258ca0cbb46bd8081b4933824f10a0f12c9384679cc573cceb`.

The distinct Node 24 readiness artifact is
`.local/readiness-evidence/conformance-client-auth-node-v24.15.0.json` with
SHA-256 `d004278f20dbf11b07b878c74f18ba563c36d1b4c508fd3dc19068be55d4d3da`.
It byte-matches
`.local/conformance/client-auth-2026-07-20T20-54-28-879Z/evidence.json` and has
the same closed 247 `SUCCESS` / 351 `INFO` status inventory. Its sorted
per-file SHA-256 manifest digest is
`f663db7a83151dba43d2c1916106d063df44c8688f0bea8eb44aff3a227887f8`.

Both reports independently record their exact Node runtime, pnpm `10.11.1`,
`GR-CONF-001`, MCP-core revision
`26897cc322f356487da89113451bd16b520b9288`, conformance revision
`ce25103b1baa6e0653e0b7bf4f79de385ea7a116`, 14 scenarios, 598 checks, zero
failures, and zero warnings. The readiness files exactly match their local
artifact manifests, and no staged `.tmp` evidence file remains. Node 24's
unchanged `DEP0190` output remains pinned-harness `shell: true` tooling output,
not a conformance warning event.

`conformance:authorization` remains unrun because no coordinator-approved real
external authorization-server target or safe configuration exists. The
governance fixture proves redaction and failure semantics only; it is not a
substitute for external-AS qualification. This continues to block protected-
resource external qualification and all release or Tier claims.

### Authorization-output repair immutable identities

For production GREEN `b7f6a6a00f4c29627fbafe080bcd0e213fd69378`:

- complete `git show --format=fuller --binary` SHA-256:
  `55af29a0a77c6fd5e95703e43a893b9ca02b0274147fd2a8ac32ce3c29c0b939`;
- literal full-index binary repair diff from rejected package `ca535f5`
  SHA-256:
  `8ccebd93237500d7e127e81898a366af1f4ac8d013e5ba881f1ef8415a7c5779`;
- literal full-index binary diff from accepted runtime base `50f4d04`
  SHA-256:
  `e40e04e55077d246f50a22c4806a80af9e90f3c74b0cbf91b033ab4ac1eb27f6`;
- `git archive --format=tar b7f6a6a` SHA-256:
  `44e23748f3af7514130e4c79d46d2d3f0bb761b2ea270af7b00c0e0f329ab214`.

The authoritative prompt, complete implementation plan, and thrice-amended WP6
preflight SHA-256 values are respectively:

- `8e19ac06cae13d25f8022b36c371067f7b25cee1c0285d0d916c3c0155221864`;
- `376997727c2a11fa5eaa4bed25482a96d21b4387b19272492dd99d13aa77f47b`;
- `be96d86995750aab285cf1d69c79af715319ea8c6b77635f99db9aee58ba3ee9`.

This is a fresh independent-review candidate only. Review must inspect the
actual `ca535f5..b7f6a6a` amendment/RED/GREEN lineage, reproduce all identities
and both artifact trees, rerun the scenario-corruption and streaming-redaction
witnesses, confirm a clean worktree and `git diff --check`, and return zero
Critical and zero Important findings before WP6 acceptance. It does not approve
WP6, mutate a remote/issue/PR, release or publish, qualify Tier 1, or complete
the Goal.

### Sealed authorization-output replacement package

The final evidence-report commit is
`b1833613c68b6fa424293f38592cf115251176e5` / tree
`efbd1f92b8abe38ba72ce9295629d07bf8873844`. Its complete `git show
--format=fuller --binary` SHA-256 is
`911c9a0293469a9a9065f6daa83c2797ef6cbbad316984f6bd20584887c0db36`.

At evidence commit `b183361`:

- the complete full-index binary repair diff from rejected package `ca535f5`
  has SHA-256
  `379cd20387ce8bda8afa2a83aca32964bdc8ba9bfaf219079480259216b9dae5`;
- the complete full-index binary diff from accepted runtime base `50f4d04` has
  SHA-256
  `c9b38230e6e6d5d7b9f024686b64dbfd583ac3a4f639a270a4941d87f6647c29`;
- `git archive --format=tar b183361` has SHA-256
  `e03a1a02a8f4e2cf04566f390c011a2f9054332f67d221f7543ec6bcad4571e5`.

This sealed package replaces rejected packages `330de22`, `03a5217`, and
`ca535f5`. Fresh review must reproduce the code, lineage, artifact, and
redaction evidence rather than accept this report's narrative. WP6 remains
unaccepted unless the review returns zero Critical and zero Important findings.

## WP6F output-close lifecycle repair candidate

Fresh independent review of sealed package `8864132` returned **REQUEST
CHANGES: 0 Critical / 1 Important / 0 Minor**. Its immutable identities,
scenario validation, atomic publication, dual-runtime cumulative gates, and
both official client-auth artifact trees reproduced. The reviewer found that
the configured external-authorization runner finalized streaming redactors on
the child `exit` event even though piped stdout and stderr can remain open until
`close`. That ordering could publish complete-looking evidence while late safe
output was truncated or a protected prefix had already been flushed. Package
`8864132` remains rejected and is not accepted as WP6 evidence.

Coordinator amendment
`91944b1cdbd303f5c187355ab1e64e453cc672db` / tree
`b10d3ed19f2983014095c2bbb75d05040f40ffee` authorizes only the process-
lifecycle repair. Its complete `git show --format=fuller --binary` SHA-256 is
`2f53403a955e348b9077804fbedc7e54d2aafc12099dc92ac0eb96c6db7b1575`.

Tests-only RED began at
`e58b29769f2efcfa6fdcb90d31102f2c0512dee5` / tree
`107d298bf4761ad0c4278e3709b9357652b6ef56`, with complete-show SHA-256
`e47f37cedbe2974935c66700193747bcc2866715aa41b09b38af25b74c5ef97b`.
Two subsequent tests-only commits corrected the synthetic descendant fixture
without touching production:

- `2ab3079ac15339e24bcc7bde3d6e6d69cd4421de` / tree
  `6666619ca3127f1998bf27e4fcfceb35586506ca`, complete-show SHA-256
  `a122656e175fe9e58719e2524e79903f3517783a84fe1d04afe75ff5f87f4bf3`;
- authoritative RED head
  `0353041008a40d0ca830f66b8318f4d97f88f27c` / tree
  `89e41346957c8cb67118f778e34026cc2441f1ff`, complete-show SHA-256
  `3e8e19278cb36b0312af8b883361fd64701c71ebb9df632590619b96d9b7c93e`.

Against the unchanged production runner, exact Node `v22.22.3` at RED head
`0353041` produced 21 passes and exactly two intended failures: the live
descendant fixture's late safe marker was absent while the first protected
prefix was observable, and the static lifecycle witness found `exit` rather
than `close`. All fixture corrections remained tests-only and preceded the
production change.

Production GREEN commit
`3d020fb3def52dfb229d72e0c329f84bb015aad4` / tree
`d5ee4dbc3306c7dd52cf6c7fe3e1467a789b3e0f` changes only two lines of behavior
and governance: `scripts/run-conformance-authorization.mjs` finalizes both
streaming redactors and resolves the runner on child `close`, and
`scripts/check-conformance-evidence.mjs` requires that lifecycle marker. The
descendant-held stdout/stderr fixture now completes the protected value across
the direct child's exit boundary, produces only `[REDACTED]`, and preserves its
late safe marker. The runner continues to stream with bounded memory and retain
the child result code.

No dependency, lockfile, generated source, SDK authorization behavior, public
API, external target, remote, issue, release, Tier, WP7+, Tasks, Apps, Visual
Effect, or language-service change was made.

### Output-close dual-runtime verification

On exact Node `v22.22.3` and Node `v24.15.0`, each with pnpm `10.11.1`:

- focused governance/evidence suite: 23/23, including the delayed descendant
  stdout/stderr lifecycle fixture and all prior adversarial checks;
- static conformance-evidence checker: pass;
- cumulative `test:wp6`: exit 0 (90 client, 19 protected-resource, 23 HTTP,
  30 package TAP tests including nested scenario subtests, and all three public
  type fixtures);
- complete loopback-permitted `CI=true pnpm run verify`: exit 0, including WP4
  HTTP 116/116 and both self-hosted draft E2E executions;
- official pinned `conformance:client-auth`: exit 0, 14 scenarios, 247 CLI
  assertions passed, zero failed, zero warnings, and 598 machine events.

The new Node 22 readiness artifact is
`.local/readiness-evidence/conformance-client-auth-node-v22.22.3.json` with
SHA-256 `6c85a16b6a61fb57197ee20cb415695c79b5edfa1b00db3b066a1ec802d2517e`.
It byte-matches
`.local/conformance/client-auth-2026-07-20T21-14-51-458Z/evidence.json`, and its
artifact tree's sorted per-file SHA-256 manifest digest is
`eb78a78e7110686fa97562b3a9534d691b5d7d68668d7482065d32f87949c3b1`.

The distinct Node 24 readiness artifact is
`.local/readiness-evidence/conformance-client-auth-node-v24.15.0.json` with
SHA-256 `114f3bfd1cc5670460c3505afe8bfd665192cf5017225d1dd97d3ab55709ffb1`.
It byte-matches
`.local/conformance/client-auth-2026-07-20T21-15-03-323Z/evidence.json`, and its
artifact tree's sorted per-file SHA-256 manifest digest is
`4c75d8559da2c895c0596a533acdbf6b8462ed6f32e77ca91df00c7a8f917a73`.

Both reports independently record their exact runtime, pnpm `10.11.1`,
`GR-CONF-001`, MCP-core revision
`26897cc322f356487da89113451bd16b520b9288`, conformance revision
`ce25103b1baa6e0653e0b7bf4f79de385ea7a116`, 14 scenarios, 247 `SUCCESS`, 351
`INFO`, 598 total checks, zero failures, zero warnings, and no other status.
Node 24's unchanged `DEP0190` remains pinned-harness `shell: true` tooling
output, not a conformance warning event.

`conformance:authorization` remains unrun because no coordinator-approved real
external authorization-server target or safe configuration exists. The
descendant lifecycle fixture proves runner output completeness/redaction only;
it is not external-AS qualification. This continues to block protected-
resource external qualification and every release or Tier claim.

### Output-close repair immutable identities

For production GREEN `3d020fb3def52dfb229d72e0c329f84bb015aad4`:

- complete `git show --format=fuller --binary` SHA-256:
  `06de00d7361ff08bb974caebcf648ac34f70ecb89b0b605fed7c882e741a410f`;
- literal full-index binary repair diff from rejected package `8864132`
  SHA-256:
  `d18d85855b53e47ed993f53102e60addbc676be9443d5410673f59b8ada3a220`;
- literal full-index binary diff from accepted runtime base `50f4d04`
  SHA-256:
  `c460feced35a32879d68451af376c0e210c4ee9aa987a6ad4bdafaad1d03d79b`;
- `git archive --format=tar 3d020fb` SHA-256:
  `e277517e068cf869580d612cfe23ac99c5074aabfd605394c01122f76cf2d20d`.

The authoritative prompt, complete implementation plan, and four-times-amended
WP6 preflight SHA-256 values are respectively:

- `8e19ac06cae13d25f8022b36c371067f7b25cee1c0285d0d916c3c0155221864`;
- `376997727c2a11fa5eaa4bed25482a96d21b4387b19272492dd99d13aa77f47b`;
- `57d6fd140960d11ba9eb3eaa64972b2247892bd4895efdf534f6641c55d04b4f`.

This remains a fresh independent-review candidate only. Review must inspect
the actual `8864132..3d020fb` amendment, complete tests-only RED lineage, and
minimal GREEN; reproduce all identities and both new artifact trees; rerun the
delayed-output witness; confirm a clean worktree and `git diff --check`; and
return zero Critical and zero Important findings before WP6 acceptance. It
does not approve WP6, mutate a remote/issue/PR, release or publish, qualify Tier
1, or complete the Goal.

### Sealed output-close replacement package

The evidence-report commit is
`a26d11bef8ad87712fed65ee8c5ce5d0426d0536` / tree
`6d07c77319897ece5aba486938c7c77fc288a587`. Its complete `git show
--format=fuller --binary` SHA-256 is
`70fed1161a562d9021e41405de3596a421b36aaeffc600fdd9112f801ea83f4e`.

At evidence commit `a26d11b`:

- the complete full-index binary repair diff from rejected package `8864132`
  has SHA-256
  `e83dde0fc6ca07853a865d62ea105ec96661b410e3085c4008d82c85342b60e7`;
- the complete full-index binary diff from accepted runtime base `50f4d04` has
  SHA-256
  `b72ac11b6473a6b77e1c2434f3c8fb294392150280354256910cdc875995064c`;
- `git archive --format=tar a26d11b` has SHA-256
  `007b2193b66408c948a4b3af06fe395dac1dcc0d9b43be4ac7c9fb9c66a2eb60`.

This sealed package replaces rejected packages `330de22`, `03a5217`,
`ca535f5`, and `8864132`. Fresh review must reproduce the lifecycle behavior,
lineage, identities, and evidence rather than accept this report's narrative.
WP6 remains unaccepted unless it returns zero Critical and zero Important
findings.

## WP6F launch-failure and output-backpressure repair candidate

Fresh independent review of sealed package `62aec1f` returned **REQUEST
CHANGES: 0 Critical / 2 Important / 0 Minor**. Its lifecycle RED/GREEN
ordering, dual-runtime gates, and official evidence trees reproduced. The
reviewer found two remaining ways for runtime behavior and machine evidence to
diverge: a package-manager child launch failure emitted an unhandled `error`
before the evidence writer ran, and flowing child `data` listeners ignored
destination backpressure. The former could omit the evidence pair and print a
default diagnostic containing configured arguments; the latter could grow an
unbounded writable queue or complete before output drained. Package `62aec1f`
remains rejected and is not accepted as WP6 evidence.

Coordinator amendment
`68deedbc11a6b0b0a16abbbd74829e70edf32692` / tree
`69ba500164d0e4a1b297126a962adcbebaffa192` requires launch failure and output
forwarding failure to become explicit nonzero evidence results. Its complete
`git show --format=fuller --binary` SHA-256 is
`954d609c9fabd475942e653da96f63f0f7dede54fb7a840c28769766f6cbf68a`.

Tests-only RED commit
`af60d2a00ea46719023db0c1b132af372670bbd1` / tree
`f9f48cb187be9ee2a1fb1395269a6fd64a1dac5b` added three bounded witnesses
before production changed:

1. an unlaunchable configured child must exit nonzero, publish byte-identical
   readiness and artifact evidence with safe `{ "kind": "url" }` provenance,
   and expose none of its configured values;
2. a 262,144-byte safe output payload held behind a paused downstream reader
   must retain both boundary markers and every payload byte; and
3. source governance requires a value-free child `error` listener, async
   iterable reads, awaited `drain`, and no flowing child `data` listeners.

Against unchanged production, exact Node `v22.22.3` produced 24 passes and
exactly two intended failures: launch failure left no evidence directory, and
the source contract found neither the launch-error handler nor the required
backpressure structure. The paused-output behavioral control passed, proving
the fixture itself was viable. The RED commit's complete-show SHA-256 is
`be7566101b9394b331c0a9dae43473a5af783ffd5b67beb2033b448e2b22e99d`.

Production GREEN commit
`8b23d1eff4f03bc52567a833a0a8c67e587edb52` / tree
`eb496f0561ee7aa97a2484161fd6e8a20950f217` closes both gaps:

- the child receives an immediate value-free `error` listener and launch
  failure maps to result `1`, allowing the existing fail-closed evidence writer
  to publish a complete failing pair without logging the error or child argv;
- stdout and stderr are consumed by independent async iterators, passed through
  the existing chunk-boundary-safe redactor, and written with an awaited
  `drain` whenever the destination rejects the current write;
- the streaming redactor now returns bounded per-input-chunk output instead of
  writing into an unobserved destination queue;
- completion waits for child `close` and both forwarding operations; launch or
  forwarding failure forces a nonzero evidence result, while safe output and
  the ordinary child result remain intact;
- a failed forwarder releases and drains its readable rather than deadlocking a
  child whose pipe would otherwise remain full; and
- the static conformance checker permanently rejects the old flowing-listener
  structure and requires all launch/backpressure markers.

The production delta changes only
`scripts/run-conformance-authorization.mjs` and
`scripts/check-conformance-evidence.mjs`. It adds no dependency, lockfile,
generated source, SDK authorization behavior, public API, external target,
remote, issue, release, Tier, WP7+, Tasks, Apps, Visual Effect, or
language-service change.

### Launch/backpressure dual-runtime verification

On exact Node `v22.22.3` and Node `v24.15.0`, each with pnpm `10.11.1`:

- focused governance/evidence suite: 26/26, including the failing-launch
  evidence pair, paused-destination payload, delayed descendant lifecycle,
  streaming redaction, atomic publication, closed scenario/check statuses, and
  requirement-mapping adversaries;
- static conformance-evidence checker: pass;
- cumulative `test:wp6`: exit 0 (90 client, 19 protected-resource, 23 HTTP,
  33 package TAP tests including nested scenario subtests, and all three public
  type fixtures);
- complete loopback-permitted `CI=true pnpm run verify`: exit 0, including WP4
  HTTP 116/116 and both self-hosted draft E2E executions; and
- official pinned `conformance:client-auth`: exit 0, 14 scenarios, 247 CLI
  assertions passed, zero failed, zero warnings, and 598 machine events.

The new Node 22 readiness artifact is
`.local/readiness-evidence/conformance-client-auth-node-v22.22.3.json` with
SHA-256 `34a967fb7e41048ba597511184d1e21cb79a78831a6c161ce625f4940688228e`.
It byte-matches
`.local/conformance/client-auth-2026-07-20T21-38-08-181Z/evidence.json`, and its
artifact tree's sorted per-file SHA-256 manifest digest is
`0f1d8d562d02285d4765430b9d23b2e5e7380416c399255f92ff4c61114d6f62`.

The distinct Node 24 readiness artifact is
`.local/readiness-evidence/conformance-client-auth-node-v24.15.0.json` with
SHA-256 `deb55c98066ba5afe2793d51818210eea7ef0284208e799e866437eb2bb248b8`.
It byte-matches
`.local/conformance/client-auth-2026-07-20T21-38-20-289Z/evidence.json`, and its
artifact tree's sorted per-file SHA-256 manifest digest is
`6646f24440e7fb47f8e3d9a7326a21141e16ba4d3f0ffd5c0ad75d77ce6ec214`.

Both reports independently record their exact runtime, pnpm `10.11.1`,
`GR-CONF-001`, MCP-core revision
`26897cc322f356487da89113451bd16b520b9288`, conformance revision
`ce25103b1baa6e0653e0b7bf4f79de385ea7a116`, 14 scenarios, 247 `SUCCESS`, 351
`INFO`, 598 total checks, zero failures, zero warnings, and no other status.
Node 24's unchanged `DEP0190` remains pinned-harness `shell: true` tooling
output, not a conformance warning event. The expected nonzero client exit in
`scope-retry-limit` remains the official negative scenario's asserted behavior.

`conformance:authorization` remains unrun because no coordinator-approved real
external authorization-server target or safe configuration exists. The new
launch-failure fixture proves that absence or failure cannot produce a green
command without complete machine evidence; it is not external-AS
qualification. External qualification, release, and Tier claims remain
blocked.

### Launch/backpressure repair immutable identities

For production GREEN `8b23d1eff4f03bc52567a833a0a8c67e587edb52`:

- complete `git show --format=fuller --binary` SHA-256:
  `378cc368ed4c18cd4616704c51f70d1bfedf7838f8a5a35a2e44e65aaffe19b4`;
- literal full-index binary repair diff from rejected package `62aec1f`
  SHA-256:
  `9f8c7375eb169c458e0f8f8cd6ca770fc5c36c4632f1793451ec826edd7b17ad`;
- literal full-index binary diff from accepted runtime base `50f4d04`
  SHA-256:
  `91510e44c0d3489c55257d94c396d751a7c1f2f4ea4cefdf668fbb82aa7a489a`;
- `git archive --format=tar 8b23d1e` SHA-256:
  `8cb049f88065a1042164405401fb8fa53050fea0db48fb64a5f56f383e46e5c7`.

The authoritative prompt, complete implementation plan, and five-times-amended
WP6 preflight SHA-256 values are respectively:

- `8e19ac06cae13d25f8022b36c371067f7b25cee1c0285d0d916c3c0155221864`;
- `376997727c2a11fa5eaa4bed25482a96d21b4387b19272492dd99d13aa77f47b`;
- `160dd8e059ecbe9d551ea0a6af4ec4dbf5aa7ec83b64a4fd8706ca921444bffd`.

This remains a fresh independent-review candidate only. Review must inspect
the actual `62aec1f..8b23d1e` amendment, tests-only RED, and GREEN lineage;
reproduce all identities and both new artifact trees; rerun the launch-failure
and paused-output witnesses; confirm a clean worktree and `git diff --check`;
and return zero Critical and zero Important findings before WP6 acceptance. It
does not approve WP6, mutate a remote/issue/PR, release or publish, qualify Tier
1, or complete the Goal.

### Sealed launch/backpressure replacement package

The evidence-report commit is
`e24b1b912cf86eae8e79c923245923f056a697a6` / tree
`eb6cb0ac2ef81ab591a662e6c540e50ada14de68`. Its complete `git show
--format=fuller --binary` SHA-256 is
`2f94a79191cc56eca9f04a5e2c263a58a631aeeb3e9461c38c798d8505f6ea63`.

At evidence commit `e24b1b9`:

- the complete full-index binary repair diff from rejected package `62aec1f`
  has SHA-256
  `7d69d502e34eefd8d461fabe793eeaf093cef6655dc3c805a9937d1b890fe8ac`;
- the complete full-index binary diff from accepted runtime base `50f4d04` has
  SHA-256
  `ba0f7d082b5dfefd70ee869c0add3d3effa61393c07b1051a5b2e29f739323c7`;
- `git archive --format=tar e24b1b9` has SHA-256
  `f56ede4e2ed24b34d88e8b542fc0d109340792c1cb7c9e1d2f2bb5e5a6b68f75`.

This sealed package replaces rejected packages `330de22`, `03a5217`,
`ca535f5`, `8864132`, and `62aec1f`. Fresh review must reproduce the launch,
backpressure, lineage, identity, and machine-evidence behavior rather than
accept this report's narrative. WP6 remains unaccepted unless it returns zero
Critical and zero Important findings.

## WP6F completed-output-write repair candidate

Fresh independent review of sealed package `ffbfc5b` returned **REQUEST
CHANGES: 0 Critical / 1 Important / 0 Minor**. Its launch-failure evidence,
bounded async-iterator forwarding, explicit `drain` path, immutable identities,
dual-runtime gates, and official artifact trees reproduced. The reviewer
demonstrated that a destination `write()` returning `true` only reports that
its high-water mark was not reached; it does not prove that the bytes completed
or that a delayed write error cannot arrive. A small final safe marker could
therefore remain queued while the configured runner forced `process.exit`, and
a delayed `EPIPE` could arrive after the forwarder had already reported
success. Package `ffbfc5b` remains rejected and is not accepted as WP6
evidence.

Coordinator amendment
`f4570c3db01547444a99c06eb1ada319f169ce38` / tree
`aea134a2bb2a6db5d714b734130e33388e8caf14` requires completion of every
non-empty write and natural configured-path termination. Its complete `git
show --format=fuller --binary` SHA-256 is
`498665ebf88490c70046dbb79792e7e5991214be88d67794a49aad9af6fbb422`.

Tests-only RED commit
`b1d189cb1fe198e5080b4e9f173a0bfa218e4e71` / tree
`488bd7aef15e651f8a90e21c8587c732afd09c90` added three independent witnesses
before production changed:

1. a preload fixture accepts a small final safe write but defers the actual
   write and completion callback; the marker must remain observable before the
   command terminates;
2. a second preload fixture accepts a write and later reports a synthetic
   completion error; the command must exit `1`, publish a byte-identical failing
   evidence pair with safe target provenance, and never print the raw error;
3. source governance requires a write-completion callback, natural configured-
   path `process.exitCode`, the existing explicit `drain`, and absence of the
   prior forced configured-path exit.

Against unchanged production, exact Node `v22.22.3` produced 25 passes and
exactly three intended failures: the delayed safe marker was absent, the
delayed write failure incorrectly exited `0`, and the source completion/exit
contract was absent. The RED commit's complete-show SHA-256 is
`1cef0debbb5741d4371eef6d7ae1f0dcaf5318f61d69e03e4659ac04be1dd297`.

Production GREEN commit
`fc5a4ff2bc5af3705f10577880b51b72c8b72fec` / tree
`468f28e087290cbd81aeb902577438f196a1a0cf` closes the remaining completion
gap:

- every non-empty redacted output chunk is forwarded one at a time with a
  write-completion callback, so a `true` return cannot be mistaken for
  completion;
- a `false` return additionally awaits `drain`, preserving the explicit
  backpressure contract while the callback proves that the chunk completed;
- synchronous throws, destination `error` events, and delayed callback errors
  all reject the forwarding operation without printing the error object;
- a callback error retains a temporary destination error listener through the
  following event-loop turn so the corresponding writable `error` event cannot
  become unhandled, then removes it; and
- the configured top-level path assigns `process.exitCode` only after child
  close and both forwarders complete, allowing pending coordinator output to
  drain naturally.

The production delta changes only
`scripts/run-conformance-authorization.mjs` and
`scripts/check-conformance-evidence.mjs`. It adds no dependency, lockfile,
generated source, SDK authorization behavior, public API, external target,
remote, issue, release, Tier, WP7+, Tasks, Apps, Visual Effect, or
language-service change.

### Completed-write dual-runtime verification

On exact Node `v22.22.3` and Node `v24.15.0`, each with pnpm `10.11.1`:

- focused governance/evidence suite: 28/28, including delayed accepted output,
  delayed write failure, launch failure, paused destination, delayed descendant
  close, streaming redaction, atomic publication, closed statuses, and exact
  requirement mapping;
- static conformance-evidence checker: pass;
- cumulative `test:wp6`: exit 0 (90 client, 19 protected-resource, 23 HTTP,
  35 package TAP tests including nested scenario subtests, and all three public
  type fixtures);
- complete loopback-permitted `CI=true pnpm run verify`: exit 0, including WP4
  HTTP 116/116 and both self-hosted draft E2E executions; and
- official pinned `conformance:client-auth`: exit 0, 14 scenarios, 247 CLI
  assertions passed, zero failed, zero warnings, and 598 machine events.

The new Node 22 readiness artifact is
`.local/readiness-evidence/conformance-client-auth-node-v22.22.3.json` with
SHA-256 `addc928f81b581d4433158f4664acf7c9aec40c92e809ff2105bcd5df0e9de0f`.
It byte-matches
`.local/conformance/client-auth-2026-07-20T21-58-25-411Z/evidence.json`, and its
artifact tree's sorted per-file SHA-256 manifest digest is
`a167a1737c024b5a7d68f01a4c90c41a17047707c1daf731f3e2fbf020a9cc50`.

The distinct Node 24 readiness artifact is
`.local/readiness-evidence/conformance-client-auth-node-v24.15.0.json` with
SHA-256 `de5dbfd8df3631104cb5f4f87d4d2fcf46b7059d9cb3900d46c992df4f850cf2`.
It byte-matches
`.local/conformance/client-auth-2026-07-20T21-58-43-396Z/evidence.json`, and its
artifact tree's sorted per-file SHA-256 manifest digest is
`29e8d01dd46ea17cbd02e8ea0c0f8104573011b0503a6377ecbbdd0e9257dedc`.

Both reports independently record their exact runtime, pnpm `10.11.1`,
`GR-CONF-001`, MCP-core revision
`26897cc322f356487da89113451bd16b520b9288`, conformance revision
`ce25103b1baa6e0653e0b7bf4f79de385ea7a116`, 14 scenarios, 247 `SUCCESS`, 351
`INFO`, 598 total checks, zero failures, zero warnings, and no other status.
Node 24's unchanged `DEP0190` remains pinned-harness `shell: true` tooling
output, not a conformance warning event. The expected nonzero client exit in
`scope-retry-limit` remains the official negative scenario's asserted behavior.

`conformance:authorization` remains unrun because no coordinator-approved real
external authorization-server target or safe configuration exists. The new
write-completion fixtures prove that accepted output and later failures cannot
produce a green configured command without complete machine evidence; they are
not external-AS qualification. External qualification, release, and Tier
claims remain blocked.

### Completed-write repair immutable identities

For production GREEN `fc5a4ff2bc5af3705f10577880b51b72c8b72fec`:

- complete `git show --format=fuller --binary` SHA-256:
  `79da36b111c91a028f007ec417a54a419ed7df3ea0187668a6e43441a0dd6a4a`;
- literal full-index binary repair diff from rejected package `ffbfc5b`
  SHA-256:
  `d3957453178b9fdf5390996bcdc9fbee9873ad81c42284a8d6659bd4828b00f3`;
- literal full-index binary diff from accepted runtime base `50f4d04`
  SHA-256:
  `9ae5e4bd0609c85903919a75a956eb29b0b5d148e59204449229c66943c7f4e1`;
- `git archive --format=tar fc5a4ff` SHA-256:
  `e4c6df4774fdffc25c995138f080ae100e192a0e8d6bb5d07f0d11bc834a16be`.

The authoritative prompt, complete implementation plan, and six-times-amended
WP6 preflight SHA-256 values are respectively:

- `8e19ac06cae13d25f8022b36c371067f7b25cee1c0285d0d916c3c0155221864`;
- `376997727c2a11fa5eaa4bed25482a96d21b4387b19272492dd99d13aa77f47b`;
- `764c937796720b40476d8392c892dbc2bbb9703c16edd90fe88f3b854be292a7`.

This remains a fresh independent-review candidate only. Review must inspect
the actual `ffbfc5b..fc5a4ff` amendment, tests-only RED, and GREEN lineage;
reproduce all identities and both new artifact trees; rerun both delayed-write
witnesses; challenge callback/error-listener ordering and natural termination;
confirm a clean worktree and `git diff --check`; and return zero Critical and
zero Important findings before WP6 acceptance. It does not approve WP6, mutate
a remote/issue/PR, release or publish, qualify Tier 1, or complete the Goal.
