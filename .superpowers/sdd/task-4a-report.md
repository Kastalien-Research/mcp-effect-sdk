# Task 4A report: exact JSON-RPC wire and error kernel

## Scope and branch state

- Branch: `codex/wp4-wire-kernel-transports`
- Worktree: `/private/tmp/mcp-effect-sdk-wp4`
- Exact accepted base: `36a2203690494e73deaa144d02ad70e7d2576afd`
- Implementation head before this report: `42208cc`
- First review-fix implementation head: `07bb02c`
- Scope: Task 4A only. Dispatcher/request streams (4B), stdio lifecycle
  replacement (4C), Streamable HTTP replacement (4D), WP5+, remote mutation,
  merge, release, and Tier claims remain excluded.

## Commits and TDD evidence

1. `20bd693` — `test: define exact JSON-RPC wire contract`
2. `d15c2a9` — `feat: add exact JSON-RPC wire kernel`
3. `42208cc` — `test: enforce notification ID absence`
4. `bf850dd` — `docs: record task 4a verification evidence`
5. `dcc7a05` — `test: define strict total wire boundaries`
6. `da50b0d` — `test: harden public wire codec and encode tag`
7. `07bb02c` — `fix: harden JSON-RPC unknown boundaries`

The committed RED checkpoint ran before production changes. Build succeeded,
then the focused runtime suite reported 10/10 expected failures: eight because
the public `McpWire` module did not exist, one because the old compatibility
adapter suppressed an ID based on notification method classification, and one
because the source guard found coercive/sentinel/duplicate-envelope patterns.
The public type fixture also failed because the root export was absent and its
negative expectations were unused.

After implementation, `test:wp4-wire` passes 10/10 runtime tests plus its strict
public type fixture. The existing generated-surface check initially exposed one
stale expectation: it supplied ID `"99"` but expected a notification method to
erase it. The check now supplies `undefined`, asserts explicit ID absence, and
the focused wire suite independently proves present IDs `""`, `0`, and numeric
strings are preserved regardless of method name.

The first independent review found four Important hostile-value gaps, then
added two related public-surface requirements before production changed. The
two committed RED checkpoints kept the original 10 tests green while exactly
four and then six new regressions failed: caller `_tag` overwrote the internal
discriminant, decode invoked throwing accessors, non-plain nested values passed,
error projection invoked accessors and mishandled `__proto__`, encode silently
reclassified inconsistent tags, and the public error codec accepted envelopes
weaker than its maintained type. Commit `07bb02c` makes all 16 pass.

## Implementation and requirements trace

1. `McpWire.JsonRpcId` is the revisioned generated `RequestId` codec: string or
   integer number only. Runtime ID type and exact string content survive decode,
   encode, and the temporary internal adapter without `String`/`Number` coercion.
2. Public discriminated request, notification, success, and error envelopes
   enforce JSON-RPC 2.0, required fields, response exclusivity, exact error
   objects, and notification-by-absence semantics.
3. Pure `Either`-returning unknown/text/UTF-8-byte decoders and text/byte
   encoders reject malformed JSON, invalid UTF-8, batches, cyclic/non-JSON
   values, invalid envelopes, and ambiguous responses with typed errors.
4. `McpSerialization` now delegates to the exact kernel. Its compatibility
   request ID is `JsonRpcId | undefined`; encoding suppresses only absent IDs.
   `McpNotifications` emits explicit absence instead of the old empty sentinel.
5. `McpErrors` centralizes Effect-native typed errors, JSON-RPC codes, default
   HTTP statuses, and recursive JSON-safe data/cause projection.
6. Revisioned generated codecs own IDs and request/notification/success
   structure. The public error-response codec is a maintained exact schema,
   cross-checked against the generated codec, because Task 4A deliberately
   requires a present ID and closed error object.
7. `test:wp4-wire` and its type fixture cover all required ID classes,
   bidirectional envelopes, malformed inputs, exact mappings, safe errors,
   UTF-8, generated parity, and compatibility behavior.
8. The owned-source guard rejects coercive IDs, empty-string notification
   inference, nullable IDs, method-based notification classification, and
   duplicate loose JSON-RPC interfaces.
9. Legacy serialization/framing exports remain only as a documented temporary
   bridge for Tasks 4B-4D; no later work-package behavior was implemented.

The maintained error-response envelope deliberately requires a present,
non-null `JsonRpcId`. The generated draft error codec permits omission, so the
kernel precondition is intentionally stricter and is covered by focused tests.
Unknown inputs are descriptor-cloned into ordinary data-only JSON objects before
generated decoding. This rejects accessors, custom prototypes, class instances,
Dates, Errors, cycles, sparse/extended arrays, symbols, and non-finite values
without retaining attacker-owned objects. Internal discriminants are assigned
after decoded fields, and encode rejects a supplied discriminant that disagrees
with the envelope. Error projection inspects descriptors without invoking
accessors and defines reserved keys as own data properties.

## Verification

All passing commands used Node `v22.22.3` through:

```bash
env PATH=/Users/b.c.nims/.nvm/versions/node/v22.22.3/bin:/opt/homebrew/bin:/usr/bin:/bin CI=true corepack pnpm ...
```

- `pnpm run test:wp4-wire` — pass, 16/16 plus public type fixture.
- `pnpm run build` — pass.
- `pnpm run sources:check` — pass, 6 pinned sources.
- `pnpm run check:generated` — pass, generated outputs current.
- `pnpm run check:schema-fixtures` — pass, 23 round-trips and 9 negatives.
- `pnpm run check:type-fixtures` — pass.
- `pnpm run test:wp3-schema` — pass, 28/28.
- `pnpm run test:wp3-protocol` — pass, 14/14.
- `pnpm run test:wp2-review` — pass, 16/16.
- `pnpm run test:unit` — pass.
- `pnpm run test:integration` — pass.
- Escalated `pnpm run verify` — pass, exit 0; both self-hosted draft e2e
  scenarios (`draft-round-trip`, `tools-call`) passed.
- `git diff --check` — pass.

The first non-escalated full verify passed all pre-e2e work and then failed only
because the sandbox denied `listen` on `127.0.0.1` with `EPERM`. The exact full
command was rerun with localhost permission and passed. The readiness compiler
continues to report MCP Tier/release claims blocked by pre-existing external,
release-provenance, documentation, and agent-evaluation evidence gates; Task 4A
does not alter or overstate those claims.

The same compatibility matrix and escalated full verify were rerun after the
first review fix at `07bb02c`; all results above remained green.

## Surprising outcomes and environment compounding

Positive: the frozen generated codecs remained reusable after a strict,
data-only JSON normalization boundary was added in front of them. The durable
improvement is one focused command covering both ordinary parity and hostile
object behavior.

Negative: an older generated-surface check encoded the former method-based
notification inference as expected behavior. The targeted environment change
is its explicit `id: undefined` assertion, which makes future notification
helpers fail if they reintroduce a sentinel.

The review cycle's surprising negative was that structurally JSON-looking live
objects can contain accessors, custom prototypes, or reserved keys that normal
property enumeration either executes or mutates. Descriptor-only cloning and
projection now make that boundary total and prototype-safe.

## Remaining risks and next actions

- The adapter retains legacy JSON/NDJSON/SSE framing until Tasks 4C/4D replace
  transport ownership; it is intentionally not the final transport design.
- Dispatcher ownership, duplicate active-ID handling, cancellation, streams,
  and handler execution remain Task 4B.
- Stateless Streamable HTTP headers/origin/SSE/retry behavior remains Task 4D.
- The raw generated error-response codec remains broader, but is no longer the
  public maintained codec; future schema revisions must explicitly reconcile
  the strict non-null-ID decision.
- Task 4A still requires coordinator-owned independent read-only review and a
  coordinator rerun of the full gate at the exact reviewed head.
