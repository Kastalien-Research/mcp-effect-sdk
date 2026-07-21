# MCP 2026-07-28 Tier-1 readiness continuation handoff

Date: 2026-07-20 America/Chicago / 2026-07-21 UTC

Goal: continue `019f6e6a-4888-7d32-915d-2747d6b05578` without restarting,
expanding, or weakening its acceptance contract.

## Authority and non-negotiable execution rules

Read these before acting:

1. `docs/prompts/2026-07-16-implement-mcp-draft-tier1-goal-mode.md`
2. `docs/plans/2026-07-16-feat-align-mcp-draft-tier1-plan.md`
3. This handoff.
4. `.superpowers/sdd/core-conformance-failure-map.md`
5. `.superpowers/sdd/progress.md`

Use only this checkout:

```text
/private/tmp/mcp-effect-sdk-wp6
```

Branch and accepted starting state:

```text
branch: codex/wp6-authorization
original goal start: f3605f5
current committed HEAD: 14f1dcfff80d5a169467eb6a02ba8c34be7c007e
```

The complete pinned official conformance inventories are the authoritative
control surface. A focused scenario is useful for diagnosis but never replaces
the complete gate. Do not call an official conformance artifact "untrusted."
Only a person's unverified narration of an artifact may be unverified.

The bounded core closure loop is:

1. Derive the complete inventory from the pinned harness.
2. Run every server and client scenario and freeze the failure map.
3. Repair each locally actionable root-cause cluster with focused TDD and the
   affected official scenario.
4. Record exact spec/harness contradictions as external blockers; do not add
   compatibility behavior that contradicts the pinned specification.
5. Rerun the complete server and client inventories on Node 22 and Node 24 and
   reconcile every result with the frozen map.

Do not invent another runner, expected-failure framework, trust hierarchy, or
acceptance mechanism. Do not repeat blind full-suite runs between every small
edit. Do not declare core closure until the final complete inventories have
actually run.

## Runtime

Use the explicit runtimes:

```text
Node 22: /Users/b.c.nims/.nvm/versions/node/v22.22.3/bin
Node 24: /Users/b.c.nims/.nvm/versions/node/v24.15.0/bin
pnpm: 10.11.1
```

Loopback listeners require approved elevated execution in this environment.
An `EPERM` from a sandboxed listener is environmental. A successful connection
followed by an empty reply, `UND_ERR_SOCKET`, or a server-side encoding error is
not an environmental pass and must be diagnosed as product behavior.

## Complete authoritative baseline

Fresh Node 22 complete inventories were run, not selected subsets:

- Server: all 40/40 scenarios at
  `.local/conformance/all-2026-07-21T01-33-14-803Z`: 74 passed checks,
  24 failed checks, 5 warnings.
- Client: all 32/32 scenarios at
  `.local/conformance/client-all-2026-07-21T01-33-41-828Z`: 434 passed checks,
  1 failed check, 0 warnings, 2 upstream-declared informational skips.

The runners derive and compare against:

```text
conformance list --server --spec-version 2026-07-28
conformance list --client --spec-version 2026-07-28
```

The closed root-cause inventory is in
`.superpowers/sdd/core-conformance-failure-map.md`.

## Accepted commits in the current core burn-down

From original goal start through current HEAD:

```text
059406a Revert "test: cover WP6F review failures"
2527494 test: keep auth runner lifecycle outside tier gate
e4f43eb Add SEP-2322 MRTR conformance fixtures
bb45892 Add stateless conformance diagnostic fixtures
61b13be docs: record core conformance burn-down
8782cc4 Add header conformance fixture
c72680a fix: allow loopback origins in everything server
dcbb328 Include missing resource URI in errors
14f1dcf fix: stream progress-token requests over SSE
```

Important correction: `059406a` reverted only the WP6F authorization
output-lifecycle test experiment. It did not revert the SDK's request-owned
progress implementation. Do not claim or imply otherwise.

Earlier accepted progress work remains in ancestry, including:

```text
c89f338 feat: own server progress by request
16bbdfb feat: own client progress by active request
7934dda test: smoke request-owned progress
3c78ea8 fix: harden server progress ownership
9ad2ff2 fix: privately brand progress callback failures
e4d43bd fix: exercise progress in core client example
c4d4755 docs: accept WP5E progress and cancellation
```

Before changing progress code again, inspect those commits and their tests.
Recover the prior design reasoning instead of re-solving the abstraction from
scratch.

## Verified burn-down before the current dirty state

MRTR at `e4f43eb`:

- focused MRTR package: 27/27 passed;
- all 14 official SEP-2322 scenarios: 21/21 checks, no failures or warnings;
- subsequent complete server inventory:
  `.local/conformance/all-2026-07-21T01-52-14-652Z` with 94 passed,
  14 failed, 3 warnings.

Stateless fixtures at `bb45892`:

- official `server-stateless`: 27/30 passed;
- the remaining three failures are the two pinned server contradictions
  described below, with the missing-client-info contradiction represented by
  two checks;
- subsequent complete server inventory:
  `.local/conformance/all-2026-07-21T01-59-39-956Z` with 98 passed,
  11 failed, 1 warning.

Header fixture at `8782cc4`:

- focused local test: 1/1 passed;
- official custom-header scenario: 9/9 passed;
- official standard-header scenario: 13/13 passed;
- subsequent complete server inventory:
  `.local/conformance/all-2026-07-21T02-07-32-059Z` with 108 passed,
  5 failed, 1 warning.

DNS at `c72680a`:

- focused official DNS scenario: 2/2 passed, no failure or warning.

Resource URI at `dcbb328`:

- Node 22 build passed;
- focused server-construction test: 26/26 passed;
- official SEP-2164 scenario: 3/3 passed, no failure or warning.

There has not yet been a complete server inventory after the DNS, resource,
and progress work. Do not infer its result from focused checks.

## Current committed progress change and its verification gap

Commit `14f1dcf` changes `dispatchOrdinaryRequest` so that an already-decoded
request with a valid string or number `_meta.progressToken` selects the
existing SSE path even when `enableJsonResponse: true`. Requests without a
progress token remain in JSON response mode; `subscriptions/listen` remains
SSE.

The committed adjacent test used a hand-built plain notification object and
passed as part of the complete HTTP test file, 61/61 on Node 22 with loopback
permission.

The pinned official `tools-call-with-progress` scenario did not pass. It
reported:

```text
Passed: 0/1, 1 failed, 0 warnings
Error: Failed: fetch failed
```

This is not an accepted environmental limitation. A direct elevated request
with the required `MCP-Protocol-Version`, `Mcp-Method`, and `Mcp-Name` headers
connected successfully and then received an empty reply.

Temporary server diagnostics were added, run, and removed. They localized the
actual failure to:

```text
ProgressNotificationParams class instance
  -> McpWire.encodeJsonRpcText
  -> SchemaValidationError: Cannot encode a non-JSON message
  -> InternalError: Could not encode HTTP response frame
  -> InternalError: HTTP response stream failed
  -> Node wrapper destroys the response after headers are considered sent
  -> client observes fetch failed / empty reply
```

The existing ignored report
`.superpowers/sdd/task-core-progress-report.md` incorrectly calls the socket
closure a local-loopback execution limitation. Treat that conclusion as
superseded by the diagnostic evidence above.

## Dirty worktree: do not lose or accept blindly

Current `git status --short`:

```text
 M src/transport/StreamableHttpServerTransport.ts
 M test/http/wp4-http-server.test.mjs
```

There is no diagnostic logging left in the source. The two uncommitted edits
are an unfinished follow-up experiment:

1. The progress SSE test now sends a real
   `McpSchema.ProgressNotificationParams` class instance instead of the prior
   hand-built plain object.
2. `validateServerNotification` uses `Schema.encodeUnknownEither` and returns
   a copied notification with the encoded params, instead of only decoding the
   payload for validation.

TDD evidence for the real class-shaped payload:

- Before the uncommitted transport edit, the focused test was RED: the stream
  contained one `-32603 Request handler defect` terminal instead of a progress
  frame and success terminal.
- After the uncommitted transport edit, `pnpm run build` passed, but the full
  HTTP file was still RED at 60/61 with the same focused test failure.

Therefore the uncommitted normalization attempt is not a solution and must not
be committed or described as green. Preserve it long enough to inspect the
exact failure, compare it with the accepted progress-history commits, and then
either correct it through TDD or remove only this handoff's unfinished edits.
Do not use destructive reset or checkout commands.

## The three pinned contradictions found by the complete inventories

These are all contradictions found in the complete baseline inventories. A
final complete rerun is still required before claiming they are the only
remaining failures.

### 1. Optional client info promoted to required

The pinned `RequestMetaObject` declares
`io.modelcontextprotocol/clientInfo?` and says clients SHOULD include it.
Alpha.9 omits it and expects the server to reject the request with JSON-RPC
`-32602` and HTTP 400. The spec-conforming server accepts it and returns 200.
One root contradiction produces two failed harness checks.

### 2. Server info checked at the wrong discover location

The pinned specification defines optional server identity at:

```text
result._meta["io.modelcontextprotocol/serverInfo"]
```

`DiscoverResult` has no top-level `serverInfo`. Alpha.9 checks
`result.serverInfo` and reports a missing mandatory field even when the
specified `_meta` field is present.

### 3. Client network-ref scenario cannot negotiate its advertised version

Alpha.9's `json-schema-ref-no-deref` scenario advertises MCP `2026-07-28` but
uses embedded `@modelcontextprotocol/sdk@1.29.0`, whose latest supported
protocol is `2025-11-25`. Negotiation fails before the client can call
`tools/list`, so the harness never evaluates the `$ref` behavior it claims to
test.

Required next artifact for these contradictions:

- one minimal exact reproducer package under `test/conformance/`;
- one concise blocker document under `docs/conformance/`;
- no production compatibility fields, downgraded version claims, or harness
  identity special cases.

## Exact next sequence

1. Inspect the accepted progress commits and their tests listed above.
2. Inspect the current two-file diff. Do not trust the unfinished
   `Schema.encodeUnknownEither` experiment.
3. Add or retain a focused RED test that exercises the real public
   request-owned progress path and the actual `ProgressNotificationParams`
   class-to-wire boundary, not a hand-built notification shortcut.
4. Make the smallest correction consistent with the existing progress design.
5. Run under Node 22:
   - `pnpm run build`;
   - the complete relevant HTTP/progress test file;
   - the pinned literal `tools-call-with-progress` official scenario.
6. Require the official scenario to show 1/1 passed and at least three
   increasing matching progress notifications. Do not translate `fetch failed`
   into a pass.
7. Commit the corrected progress slice atomically only after the focused local
   and official checks pass.
8. Add the three exact contradiction reproducers and blocker document; run
   their focused test.
9. Perform the single independent core review over `f3605f5..HEAD`; repair any
   accepted findings.
10. Run the complete server and client inventories on fresh Node 22 and Node
    24. Reconcile every scenario/check against the frozen map. The expected
    external residue is three server failed checks from two contradictions and
    one client failed check from the embedded-SDK contradiction, with no local
    failures or warnings. This expectation is not evidence; the artifacts are.
11. Update `.superpowers/sdd/progress.md` and the conformance evidence docs with
    exact artifact paths and counts.
12. Continue rather than stop at core: WP7 Tasks, WP8 Apps server/View, WP9
    Apps Host/preview, WP10 release qualification, and WP11 final
    reconciliation.

## Commands

Set a runtime explicitly before every gate:

```bash
export PATH=/Users/b.c.nims/.nvm/versions/node/v22.22.3/bin:$PATH
node --version
pnpm --version
```

Core commands:

```bash
pnpm run build
node --test test/http/wp4-http-server.test.mjs
pnpm run conformance:run
pnpm run conformance:client
pnpm run conformance:client-auth
pnpm run verify
```

The literal focused official scenario uses the pinned private package:

```bash
pnpm --dir test/conformance exec conformance server \
  --url http://127.0.0.1:3000/mcp \
  --spec-version 2026-07-28 \
  --scenario tools-call-with-progress
```

Run the Everything server in the same approved loopback context:

```bash
HOST=127.0.0.1 PORT=3000 pnpm run conformance:server
```

Repeat the final gates with:

```bash
export PATH=/Users/b.c.nims/.nvm/versions/node/v24.15.0/bin:$PATH
```

## Remaining goal and approval boundaries

Core completion is not the entire goal. After core and its independent review:

- WP7: Tasks.
- WP8: Apps server/View.
- WP9: Apps Host/preview.
- WP10: release-candidate qualification.
- WP11: final reconciliation and approval-gated disposition.

Do not claim MCP Tier readiness or designation before the final specification,
complete official evidence, publication approval, and Working Group
designation. Do not merge, publish, tag, close/reclassify remote issues, or
mutate external authorization infrastructure without the required user
approval.

At every handoff, report exact commands, versions, artifact paths, pass/fail
counts, unrun gates, dirty files, commits, and remaining external blockers.
Narrative confidence is not a substitute for those records.
