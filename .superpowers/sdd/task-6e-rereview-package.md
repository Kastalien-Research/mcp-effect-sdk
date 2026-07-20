# WP6E immutable repair rereview package

Independently rereview the exact repaired WP6E Streamable HTTP authorization
candidate. Do not edit the worktree. Findings must be classified Critical,
Important, or Minor and the verdict must be APPROVE or REQUEST CHANGES. Any
Critical or Important finding blocks local acceptance.

## Authorities to read completely

- `docs/prompts/2026-07-16-implement-mcp-draft-tier1-goal-mode.md`
- `docs/plans/2026-07-16-feat-align-mcp-draft-tier1-plan.md`
- `.superpowers/sdd/task-6-preflight.md`
- `.superpowers/sdd/task-6-report.md`
- `.superpowers/sdd/task-6e-review-package.md`
- the vendored authorization prose under
  `sources/vendor/mcp-core/authorization/`

Authority/evidence SHA-256 values before this package commit:

- prompt: `8e19ac06cae13d25f8022b36c371067f7b25cee1c0285d0d916c3c0155221864`;
- plan: `376997727c2a11fa5eaa4bed25482a96d21b4387b19272492dd99d13aa77f47b`;
- amended WP6 preflight:
  `4d42f70e03c65c2ebd27f7a39c2eecc8c10f9d1e75dabb72c205d6a4bb27c04e`;
- repair evidence report:
  `de259e7a9e6cdbe0ffe304c507df4746d057e858492881250ea0327196e27d2f`;
- progress ledger:
  `4c688290e1fddf5a7683037f736296472ee50c688ee3c9e85f4c069f22f1318e`.

The evidence commit before this sealed package is
`c6a255be11f7aece8b2418ff632d11a37f17ab4e`, tree
`eb7018158de611e2af65f624e21576626e4d9460`.

## Frozen repair candidate identity

- accepted WP6D base: `4772ba713157a5d7c854a9ee445f4bf481aacfc7`;
- first rejected WP6E code candidate:
  `598b7c2650057bf5a14c7b3f6e965147e1598829`;
- approved repair-amendment base:
  `f0fab856d160d6798e3ec9a4b5752ed8c7e020e7`;
- repaired code candidate:
  `9198c4730c37471d4b63db6fe8acb0933daad728`;
- repaired code tree: `807a5fd5d53d75d5fe022319cf38cef1d29a021b`;
- candidate archive SHA-256:
  `a0058f04658d76835389546ccef85ab0c8387223b6115efd154c00d553e8f2f4`;
- accepted-WP6D-base cumulative binary diff SHA-256:
  `5be7e9cf1d68db4ce6dbe195fd882b9384fb12bb6569972f92b3159bc09185d6`;
- approved-amendment-to-repair binary diff SHA-256:
  `a1fc5976d6d13d7fba3862c38ad915748dfa583e2bd7bffa5e7baf19454e00ce`;
- first-candidate-to-repair binary diff SHA-256:
  `13a091b30680d0e152afbd7c02d14b9a039c63b75c2eb327f70e02bdf616a62a`.

Repair TDD commits and per-step binary diff hashes:

1. RED `fb5e3b6eca9cd00074fd11402840269f2f5c77c4` —
   `845759cd65aca8f10a37a9b9458383e3ed021c8fb4e14931aca24728c88f388a`;
2. helpers GREEN `c3a6056050fdac10cff1ac5ccee5a1ce9811e463` —
   `ff297287a6bf9680256cbfd450f8dbb4d5f4978dbc0988117484dc7302d9b77c`;
3. client GREEN `02f47e9e7cf558f972b6a581304f5b8f06f6453e` —
   `64404de17e7a27433e52e23ee61c1411a42d8d65e9a1b833ec31f2739c147f2b`;
4. server GREEN `9198c4730c37471d4b63db6fe8acb0933daad728` —
   `d3cfecf96d1980bf022b4150b568387611de308cab6dbec5d390f9890d78e800`.

Reproduce every identity and diff rather than trusting this ledger.

## Repair-only files

- `src/auth/common.ts`;
- `src/auth/protected-resource.ts`;
- `src/auth/protected-resource/errors.ts`;
- `src/auth/protected-resource/services.ts`;
- `src/transport/StreamableHttpClientTransport.ts`;
- `src/transport/StreamableHttpServerTransport.ts`;
- `test/auth/wp6b-protected-resource-boundary.test.mjs`;
- `test/http/wp6-http-client-auth.test.mjs`;
- `test/http/wp6-http-protected-resource.test.mjs`;
- `test/packaging/wp6b-auth-subpaths.test.mjs`;
- `test/types/wp6-auth-protected-resource/wp6-auth-protected-resource.ts`;
- `test/types/wp6b-auth-public/protected-resource.ts`.

The cumulative WP6E candidate also contains the files listed in the first
review package. No dependency, lockfile, generated protocol/schema,
package/script, further example, external target, remote, issue/PR, release, or
Tier mutation is in the repair.

## Required finding-by-finding adjudication

First reproduce the six prior Important findings, then determine whether each
is fully resolved without regression:

1. arbitrary authorized-fetch rejection causes cannot retain or expose raw
   bearer tokens, while the pre-existing unauthenticated Cause contract remains
   intact;
2. only a pure typed token-verification failure becomes a token fact;
   Fail-plus-defect is a non-challenge 500 and any Cause containing interruption
   remains interruption;
3. the client recognizes complete HTTP `token` grammar for schemes and
   auth-parameter names, including a digit-leading other scheme and dotted
   extension parameter, without accepting malformed Bearer challenges;
4. `AuthorizationScope` implements exact RFC 6750 `scope-token` grammar and
   invalid configuration fails deterministically before header construction;
5. `mcp-effect-sdk/auth/protected-resource` publicly owns typed bearer
   extraction, Redacted token handoff, verifier composition, token-free exact
   principal validation, scope policy, and deterministic safely escaped
   challenge serialization; the HTTP server must reuse these helpers rather
   than private duplicates, and the emitted graph remains platform-neutral;
6. HeaderMismatch -> internal refresh -> authorization -> successful original
   retry has an explicit regression witness, with both one-use budgets still
   independent and non-multiplying in both orderings.

Also reassess the entire cumulative WP6E boundary: 401/403 semantics, prior
grant and cumulative scope behavior, caller Authorization suppression,
cancellation, verifier failures/defects, dispatch-before-policy prevention,
principal confinement, trusted hook replacement, the two earlier compile-only
example migrations, TDD integrity, exact file scope, and secret-free errors and
evidence.

## Independent verification

On Node `v22.22.3` and `v24.15.0`, run build and the direct WP6 matrix over:

- `test/auth/wp6b-client-boundary.test.mjs`;
- `test/auth/wp6b-protected-resource-boundary.test.mjs`;
- every `test/auth/wp6c-*.test.mjs`;
- every `test/auth/wp6d-*.test.mjs`;
- `test/http/wp6-http-client-auth.test.mjs`;
- `test/http/wp6-http-protected-resource.test.mjs`;
- `test/packaging/wp6b-auth-subpaths.test.mjs`;
- both protected-resource public type fixtures.

The coordinator recorded 118/118 plus both type fixtures and full
`CI=true pnpm run verify` exit 0 on both supported Node lines with loopback;
independently reproduce focused gates on both and the WP4/full gate where the
environment permits. Do not count `listen EPERM` as acceptance evidence.

Do not run official conformance or mutate an external authorization server,
remote, issue, PR, release, Tier, or Goal state. Return exact identity
reproduction, commands/counts, tight file/line findings, a verdict, and all
residual non-claims.
