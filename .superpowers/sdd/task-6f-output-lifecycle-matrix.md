# WP6F authorization evidence-boundary matrix

## Purpose and invariant

This matrix is the review and test authority for the configured authorization
runner. Candidate `bdd6564` is rejected: terminal output listeners and process
exit ordering are not evidence authorities.

The replacement is artifact-first. The runner owns one forward-only sequence:

`target resolution -> stale readiness removal -> child launch -> stdout/stderr
capture and redaction -> stream close -> atomic log publication -> check
collection -> schema validation -> semantic adjudication -> normalized result
-> atomic evidence-pair publication -> pair re-read verification -> explicit
configured exit`.

The terminal state is selected once. Configured exit `0` is valid only when the
current readiness and artifact evidence files are complete, schema-valid,
semantically passing, byte-identical after re-read, and both record
`exitCode: 0`. Every published failure records `exitCode: 1`, never a raw child
status. If malformed input or a publication failure prevents a valid current
pair, the configured exit is `1` and the stale readiness path remains absent.

Child stdout and stderr are never forwarded to `process.stdout` or
`process.stderr`. Complete redacted `stdout.log` and `stderr.log` files are
published in the run artifact directory before evidence settlement. Terminal
reporting is non-authoritative, so no callback, drain, close, error,
`beforeExit`, or `exit` listener order on a terminal destination participates
in green qualification.

## Owned state transitions

| Owner | From | To | Failure transition |
| --- | --- | --- | --- |
| configured runner | initialized | stale readiness absent | terminal failure |
| child owner | not launched | launched | launch failure |
| capture owner | launched | stdout/stderr closed and redacted | capture failure |
| log owner | captured | both logs atomically published and re-read | terminal failure |
| evidence builder | logs published | checks collected and report schema-valid | terminal failure |
| adjudicator | schema-valid | normalized pass or failure | terminal failure |
| evidence publisher | adjudicated | current byte-identical pair re-read and verified | terminal failure |
| configured runner | pair verified | explicit OS exit `0` or `1` | terminal failure `1` |

No transition returns to an earlier state and no process lifecycle listener may
select or revise the terminal result.

## Executable legacy-terminal isolation matrix

Every row below is executed from
`test/fixtures/wp6-authorization-output-lifecycle.mjs`. Each fake child exits
zero with one successful check. The expected result is therefore a green,
byte-identical pair and OS exit `0`, with the child marker present only in the
artifact-local log. A row fails if the configured runner writes the marker to
a terminal destination, awaits a destination callback/event, reaches
`beforeExit`, leaks an unhandled output error, or publishes a result that
disagrees with the OS.

| Legacy terminal transition or ordering trap | Artifact-first expectation | Witness |
| --- | --- | --- |
| no destination override | logs and green pair / exit `0` | shared matrix `native-success` |
| `true` + synchronous callback | trap unreachable / exit `0` | shared matrix `callback-sync-success` |
| `true` + asynchronous callback | trap unreachable / exit `0` | shared matrix `callback-async-success` |
| `false` + callback then `drain` | trap unreachable / exit `0` | shared matrix `backpressure-drain-success` |
| `drain` before callback | trap unreachable / exit `0` | shared matrix `drain-before-callback` |
| `error` before callback | trap unreachable / exit `0` | shared matrix `error-before-callback` |
| `error` with no callback | trap unreachable / exit `0` | shared matrix `error-without-callback` |
| asynchronous callback error | trap unreachable / exit `0` | shared matrix `callback-async-error` |
| `close` before callback | trap unreachable / exit `0` | shared matrix `close-before-callback` |
| accepted silent write | trap unreachable / exit `0` | shared matrix `silent-accepted` |
| backpressured silent write | trap unreachable / exit `0` | shared matrix `silent-backpressured` |
| synchronous write throw | trap unreachable / exit `0` | shared matrix `synchronous-throw` |
| callback then microtask error | trap unreachable / exit `0` | shared matrix `post-callback-microtask-error` |
| callback then timer error | trap unreachable / exit `0` | shared matrix `post-callback-timer-error` |
| `beforeExit` then microtask error | no `beforeExit`; explicit exit `0` | shared matrix `before-exit-microtask-error` |
| repeated `beforeExit` timer error | no `beforeExit`; explicit exit `0` | shared matrix `before-exit-timer-error` |
| repeated `beforeExit` immediate error | no `beforeExit`; explicit exit `0` | shared matrix `before-exit-immediate-error` |
| preload-time `exit` listener error | value-free contained, non-authoritative / exit `0` | shared matrix `exit-sync-error` |
| earlier `beforeExit` registers `exit` listener after old finalizer | no `beforeExit`; late listener never registers / exit `0` | shared matrix `exit-listener-from-before-exit` |
| stderr-only destination error | stderr artifact log; trap unreachable / exit `0` | shared matrix `stderr-only-error` |
| stdout drain plus stderr error | both artifact logs; traps unreachable / exit `0` | shared matrix `dual-sink-error-drain` |

## Executable semantic evidence matrix

| Child/check result | Configured and evidence result | Current-pair expectation |
| --- | --- | --- |
| child `0`, one successful check | `0` | complete, byte-identical, re-read verified |
| child `0`, zero scenarios/checks | `1` | complete failing pair |
| child `0`, scenario missing `checks.json` | `1` | complete failing pair |
| child `0`, empty `checks.json` | `1` | no stale readiness or partial current pair |
| child `0`, malformed `checks.json` | `1` | no stale readiness or partial current pair |
| child `0`, warning check | `1` | complete failing pair |
| child `0`, failed check | `1` | complete failing pair |
| raw child exit `2`, otherwise successful checks | normalized `1` | complete failing pair; raw `2` absent |
| launch failure | `1` | complete failing pair when checks can be represented |
| evidence/log publication or re-read failure | `1` | stale readiness absent; no green pair |

Every test helper that observes a published path asserts all four conditions:
readiness bytes equal artifact bytes, parsed `exitCode` is exactly `0` or `1`,
OS exit equals evidence exit, and stale seeded bytes were replaced. Paths that
cannot publish a valid pair assert that the stale readiness file is absent.

## Completeness rule

A future repair is incomplete unless a newly discovered child, capture, log,
check, adjudication, publication, or configured-exit equivalence class is added
here and executed before production changes. Reintroducing live terminal
forwarding requires a new structural proof; listener-order patches are not an
accepted substitute.
