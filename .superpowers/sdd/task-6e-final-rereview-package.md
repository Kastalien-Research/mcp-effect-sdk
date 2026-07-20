# WP6E immutable final rereview package

Independently review the exact final WP6E authorization candidate. Do not edit
the worktree. Classify findings Critical, Important, or Minor and return
APPROVE or REQUEST CHANGES. Any Critical or Important finding blocks local
acceptance.

## Authorities

Read completely:

- `docs/prompts/2026-07-16-implement-mcp-draft-tier1-goal-mode.md`;
- `docs/plans/2026-07-16-feat-align-mcp-draft-tier1-plan.md`;
- `.superpowers/sdd/task-6-preflight.md`;
- `.superpowers/sdd/task-6-report.md`;
- `.superpowers/sdd/task-6e-review-package.md`;
- `.superpowers/sdd/task-6e-rereview-package.md`;
- the vendored authorization prose under
  `sources/vendor/mcp-core/authorization/`.

Authority/evidence SHA-256 values before this package commit:

- prompt: `8e19ac06cae13d25f8022b36c371067f7b25cee1c0285d0d916c3c0155221864`;
- plan: `376997727c2a11fa5eaa4bed25482a96d21b4387b19272492dd99d13aa77f47b`;
- final amended preflight:
  `cfec3b531f58b5dd4fbbc1f888b843c871862ae005199787fdcaa09f7ac04f29`;
- final candidate report:
  `8631e91c3960015143194fdbadc3deb823f1558a330996eac3dd89df165b84c9`;
- progress ledger:
  `bf4fb419d0840fd5b7eae3adaf03bb8b0c6bc3d8f4956b9e4faebf66cb4652c4`.

Evidence predecessor HEAD/tree:
`d09b329f9ab4238f815bb9b9a0bd40f36050ad4a` /
`9a520f21ab007ddc91a9f8c7c56ef1d8be734ac0`.

## Frozen code identity

- accepted WP6D base: `4772ba713157a5d7c854a9ee445f4bf481aacfc7`;
- first rejected WP6E candidate:
  `598b7c2650057bf5a14c7b3f6e965147e1598829`;
- first repaired candidate:
  `9198c4730c37471d4b63db6fe8acb0933daad728`;
- final code candidate:
  `6b60f8e95d07167781681c19addddac3140d4d82`;
- final code tree: `c426534260410c3466bc55aef193fbe6e22b8c37`;
- archive SHA-256:
  `52a9a5cb05988e2685654105ee30102cbbe6074c9076866151012a791f18285d`;
- accepted-WP6D-base cumulative diff SHA-256:
  `0cc89ec59a6ce48e20a5e141372f2acbc63525bb2e4f007c706298639f825da1`;
- prior-repair-to-final diff SHA-256:
  `323762b6573e1b716634e4fbe3411f586abe1a9a23ad701dc850c53d903af3a2`;
- second-amendment-to-final diff SHA-256:
  `d2a78c2cf2952c4660f80c81114ce0608752b54ba0f5311c01090dbd3beb1fac`.

Final TDD commits:

1. RED `8b0264644ec4b8d50e8c7baaa8b4fdad1c048301`, binary diff
   `2ae568c0080e5d0f837b7994de239b03a2033f08b8e440a778183842556a2582`;
2. GREEN `6b60f8e95d07167781681c19addddac3140d4d82`, binary diff
   `13940fffcc0df0972b0057c74123d5ae7f278be13fce435852eac1d741a052a3`.

Reproduce all identities and prior repair hashes from the report rather than
trusting the ledger.

## Final repair scope

Test-only RED:

- `test/auth/wp6b-protected-resource-boundary.test.mjs`;
- `test/packaging/wp6b-auth-subpaths.test.mjs`;
- `test/types/wp6-auth-protected-resource/wp6-auth-protected-resource.ts`;
- `test/types/wp6b-auth-public/protected-resource.ts`.

Production GREEN:

- `src/auth/protected-resource.ts`;
- `src/auth/protected-resource/services.ts`;
- `src/transport/StreamableHttpServerTransport.ts`.

No dependency, lockfile, generated, package/script, example, external target,
remote, issue/PR, release, Tier, or Goal mutation is in this repair.

## Required adjudication

Reproduce the prior Important finding and establish whether it is fully fixed:

1. `mcp-effect-sdk/auth/protected-resource` publicly exports an Effect-native
   already-verified embedding adapter with an unknown input and typed safe
   failure;
2. exact decoded token-free `AuthorizationPrincipal` input succeeds through a
   fresh canonical snapshot;
3. plain objects, token-bearing objects, extra-own-key principals, accessors,
   hostile/revoked proxies, wrong prototypes, and invalid field shapes fail
   typed without invoking accessors or leaking input;
4. both `verifyBearerAuthorization` and the server's
   `verifiedAuthorizationPrincipal` compatibility hook reuse that public
   adapter;
5. neither auth services nor server transport retains a private
   `exactAuthorizationPrincipal` duplicate;
6. exact runtime/package/type exports and emitted graphs remain correct and
   platform-neutral.

Then reassess the complete cumulative WP6E candidate and all six findings from
the first review: authorized-fetch token confinement, pure Cause
classification, complete HTTP token grammar, exact RFC 6750 scope grammar,
all public protected-resource helpers/reuse, both retry orderings, challenge
semantics, prior-grant behavior, cancellation, principal confinement, hook
replacement, example compile migrations, TDD integrity, file scope, and
secret-free errors/evidence.

## Verification

Independently run build, the direct WP6 auth/HTTP/package matrix, and both
protected-resource type fixtures on Node `v22.22.3` and `v24.15.0`. The sealed
coordinator result is 119/119 plus both type fixtures and full
`CI=true pnpm run verify` exit 0 on each runtime, including WP4 HTTP 116/116
plus three type fixtures and both draft E2E executions. Reproduce focused
gates on both and WP4/full gates where loopback permits; never count
`listen EPERM` as acceptance evidence.

Do not run official conformance, client-auth conformance, or a real external
authorization server. Do not mutate remotes, issues, PRs, releases, Tier, or
Goal state. Return exact identity reproduction, commands/counts, tight
file/line findings, explicit verdict, and residual non-claims.
