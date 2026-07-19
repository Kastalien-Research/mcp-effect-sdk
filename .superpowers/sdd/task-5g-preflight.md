# Task 5G preflight: scoped subscriptions

## Frozen scope

- Base: accepted WP5F closeout `54e7af98d437183c40e0c910e7fbb73a8706aab6`
  (tree `b03538dedc6b458560b75317c1d20d70e1961fb3`).
- Implement only the stable client `Subscription` product above the accepted
  WP4 request-scoped transport, dispatcher, acknowledgement, filter, terminal,
  and cancellation mechanics.
- Do not edit generated output, add dependencies, redesign transports or the
  server registry, or begin WP5H/auth/Tasks/Apps/release/Tier work.

## Public type and runtime contract

- `McpClient.subscriptionsListen(filter?)` becomes a scoped acquisition. It
  returns only after the exact first acknowledgement and has type
  `Effect<Subscription, McpClientError, Scope.Scope>`; the transitional
  long-lived `Effect<unknown, McpClientError>` and its progress-options
  argument are removed without an alias. The method is intentionally
  filter-only.
- `Subscription` exposes:
  - `acknowledgedFilter`: an immutable exact snapshot of the generated
    acknowledgement's `notifications` value;
  - `notifications`: a single-consumer
    `Stream<SubscriptionNotification, SubscriptionAbruptError |
    SubscriptionProtocolError>` containing only the four generated selected
    change-notification types (the acknowledgement is lifecycle state, not a
    stream element);
  - `close`: an idempotent `Effect<void>`;
  - `closed`: a never-failing `Effect<SubscriptionClosure>` that completes
    exactly once.
- `SubscriptionNotification` is the discriminated generated union of tool,
  prompt, and resource list changes plus resource updates.
- `SubscriptionClosure` is an exact tagged union: `CallerClosed` (explicit
  `close` or caller-scope finalization), `Graceful` (with the exact decoded
  `SubscriptionsListenResult`), `Abrupt` (with
  `SubscriptionAbruptError`), or `ProtocolError` (with
  `SubscriptionProtocolError`). The two error classes expose constant safe
  messages, stable safe reasons, and retain the complete original `Cause`
  non-enumerably. Abrupt reasons are `UnexpectedEnd`, `Transport`, `Overflow`,
  or `Dispatch`; protocol reasons identify acknowledgement, frame, and terminal
  violations without embedding hostile values.
- `./client` exports the product, notification/closure types, and two typed
  errors. The root continues to expose them only through its existing
  `McpClient` namespace. No package subpath is added.

## Validation and ownership

- Requested filters are snapshotted without getters/coercion and validated by
  the exact generated `SubscriptionFilter` codec before IDs, providers, or
  transport effects. Absent means the generated empty filter.
- Every open uses the existing fresh request-ID allocator and per-request
  metadata/capability provider path. The first frame must be an exact generated
  acknowledgement for that exact typed ID and a subset of the requested core
  filter. Later frames must carry the same exact ID, decode through their exact
  generated notification codec, and remain within the acknowledged filter.
  Duplicate acknowledgements, progress/cancel frames in HTTP subscription
  streams, JSON-RPC errors after acknowledgement, malformed results, mismatched
  IDs, unselected notifications, post-terminal frames, and missing terminals
  are protocol closure, except that EOF after a valid acknowledgement with no
  terminal is the specification-defined `Abrupt/UnexpectedEnd` transport
  close.
- State is one serialized `Opening -> Open -> Closed` machine. The first
  caller close, graceful terminal, transport failure, protocol failure, or
  parent-scope finalizer wins. Later events cannot overwrite the closure,
  enqueue notifications, or perform a second teardown.
- The owner fiber is forked in the caller scope before awaiting acknowledgement;
  interrupted/failed opening explicitly tears it down and never returns a
  product. Before-ack protocol or transport failure remains a `McpClientError`
  with complete Cause because no `Subscription` exists. Parent-scope exit
  settles an open product as `CallerClosed` and tears it down.
  `close` interrupts and joins that exact request owner. This releases the HTTP
  response reader/AbortController, while the accepted stdio request finalizer
  sends exactly one normative `notifications/cancelled` with `requestId`.
- Delivery is bounded to 16 pending notifications plus one reserved terminal
  slot. Saturation fails that subscription only, as an abrupt closure, without
  blocking close, `closed`, or another request even if the notification stream
  is never consumed. No detached fiber, global notification pump, unbounded
  queue, automatic relisten, or orphan owner is introduced.
- Selected notifications retain existing ordered cache invalidation/global
  dispatch before publication to the product stream. Callback/cache failures
  close only the owning subscription as abrupt failures and retain their full
  Cause. Pure/mixed interruption topology is not flattened.

## RED witnesses and gates

- Add `test/client/wp5g-subscription.test.mjs` and a public type fixture proving:
  acknowledgement-before-return, exact acknowledged filters, discriminated
  typed notifications, numeric/string ID exactness, concurrent interleaving,
  graceful result closure, idempotent caller close, abrupt EOF/transport close,
  protocol-invalid closure, first-winner races, queue saturation, complete
  Cause topology/interruption, hostile filter boundaries, opening interruption,
  parent-scope cleanup, and unrelated-request survival.
- Add real transport witnesses: HTTP caller close cancels/releases the response
  body without a cancellation POST; stdio caller close emits the accepted exact
  cancellation notification once and does not close another request.
- Update the one catalog example and inherited WP4/type witnesses to consume
  the returned product rather than fork the removed long-lived Effect.
- Commit the tests/type/package-surface changes while production is absent and
  record their deterministic failures. Then implement in small GREEN commits.
- Focused Node 22 gates: build, new runtime/type/package tests, WP4 dispatcher
  31/31, stdio 22/22, HTTP 116/116, transports 12/12. Cumulative gates:
  accepted WP5A-F, source/generated/invariant/type/package checks, exact
  `CI=true pnpm run verify`, `git diff --check`, and clean tracked status.

## Primary risks

- Teardown must not convert locally owned interruption into an abrupt remote
  close or allow a late terminal to replace caller close.
- A bounded notification queue must reserve terminal capacity so close cannot
  deadlock behind an unconsumed stream.
- The product must preserve cache/global notification behavior without
  reintroducing a connection-global owner or dispatching the acknowledgement
  as an ordinary change notification.
