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
