# WP6E immutable independent review package

Review the exact WP6E Streamable HTTP authorization candidate. Do not edit the
worktree. Findings must be classified Critical, Important, or Minor and the
verdict must be APPROVE or REQUEST CHANGES. Any Critical or Important finding
blocks local acceptance.

## Authorities to read completely

- `docs/prompts/2026-07-16-implement-mcp-draft-tier1-goal-mode.md`
- `docs/plans/2026-07-16-feat-align-mcp-draft-tier1-plan.md`
- `.superpowers/sdd/task-6-preflight.md`
- `.superpowers/sdd/task-6-report.md`
- the vendored authorization prose under
  `sources/vendor/mcp-core/authorization/`

Authority SHA-256 values at packaging time:

- prompt: `8e19ac06cae13d25f8022b36c371067f7b25cee1c0285d0d916c3c0155221864`;
- plan: `376997727c2a11fa5eaa4bed25482a96d21b4387b19272492dd99d13aa77f47b`;
- amended WP6 preflight:
  `f595c7d5670c25a615487c4866d2774fe333ac2f6bfcefbea7da6b697c0cb91c`.

## Frozen candidate identity

- accepted WP6D base: `4772ba713157a5d7c854a9ee445f4bf481aacfc7`;
- final code candidate: `598b7c2650057bf5a14c7b3f6e965147e1598829`;
- final tree: `e7ed70ed5ff7f888c6704a6a3330835f3eccf332`;
- candidate archive SHA-256:
  `920d04af8fe3c49c78466690f2862585cce22e417b777b41ba75ffdf3fc58f43`;
- accepted-base cumulative binary diff SHA-256:
  `57baa71606fcc4172e4a59c964bd29e349e4e2bf551084febcd4ffaafa07bd15`.

TDD commits and per-step diff hashes are recorded in the WP6E section of
`.superpowers/sdd/task-6-report.md`. Reproduce them rather than trusting the
ledger.

## Files in review scope

- `.superpowers/sdd/task-6-preflight.md`;
- `src/examples/core-protocol-catalog.ts`;
- `src/examples/everything-client.ts`;
- `src/transport/StreamableHttpClientTransport.ts`;
- `src/transport/StreamableHttpServerTransport.ts`;
- `test/http/wp4-http-client.test.mjs`;
- `test/http/wp4-http-server.test.mjs`;
- `test/http/wp6-http-client-auth.test.mjs`;
- `test/http/wp6-http-protected-resource.test.mjs`;
- `test/types/wp4-http-server/wp4-http-server.ts`;
- `test/types/wp6-auth-protected-resource/**`.

No package, dependency, lockfile, generated protocol/schema, root/client/server
entrypoint, auth core, external target, or release mutation is in this
candidate.

## Required adjudication

Independently inspect and test at least:

1. valid 401 Bearer selection, including multiple authentication schemes,
   strict malformed challenge rejection, and one bounded authorization retry;
2. 403 step-up only for `insufficient_scope`, prior-grant propagation,
   cumulative-scope preservation through the accepted client service, and no
   generic-403 login loop;
3. caller Authorization suppression, Redacted grant extraction, resource/token
   validation, safe error inspection, and cancellation/interruption;
4. independence and non-multiplication of authorization and HeaderMismatch
   recovery budgets in both orderings;
5. bearer grammar/extraction, exact 401/403 challenge serialization and
   escaping, explicit resource-metadata linkage, verifier error/defect/
   interruption classification, and scope checks before dispatch;
6. raw bearer confinement to `TokenVerifier`, exact decoded token-free
   principal propagation to ordinary and extension-notification contexts, and
   rejection of token-bearing or verifier-bypassing trusted hook shapes;
7. public/type contract replacement of `authInfo`, Effect-native service
   boundaries, descriptor/accessor/prototype containment, and whether the
   protected-resource subpath owns every public helper promised by the frozen
   architecture;
8. the two coordinator-approved example migrations for compile preservation,
   including whether either introduces an unacceptable functional regression
   before WP6F re-authoring;
9. TDD integrity, exact changed-file scope, and absence of dependency,
   generated, package/script, remote, release, conformance, or Tier drift.

Run the direct WP6 runtime/type matrix on Node 22 and Node 24. Run the relevant
WP4 HTTP gate and full verification where the environment permits loopback.
Do not count `listen EPERM` as acceptance evidence. Do not run official
conformance or mutate an external authorization server, remote, issue, PR,
release, or Goal state.

Return exact identity reproduction, tests/commands and counts, findings with
tight file/line evidence, verdict, and residual non-claims.
