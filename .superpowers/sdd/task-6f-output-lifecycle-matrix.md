# WP6F authorization output lifecycle matrix

## Purpose and invariant

This matrix is the review and test authority for
`scripts/run-conformance-authorization.mjs`. It replaces counterexample-by-
counterexample reasoning with explicit transition classes.

For a configured authorization run, exactly one of these outcomes is valid:

1. child exit `0`, both forwarders complete, both targets remain healthy
   through the one-shot process exit phase, the evidence pair is complete and
   byte-identical with `exitCode: 0`, and the OS process exits `0`; or
2. any child, forwarding, target-lifecycle, evidence-publication, or evidence-
   validation failure produces OS exit `1`; when the filesystem permits
   evidence publication, both evidence files are complete, byte-identical, and
   record `exitCode: 1`.

Exit `13`, raw unhandled output errors, green stale evidence, partial evidence,
and output after terminal evidence are forbidden.

## State dimensions

| Dimension | Accounted equivalence classes |
| --- | --- |
| `write()` result | `true`, `false`, synchronous throw |
| callback | synchronous success, asynchronous success, asynchronous error, absent |
| destination event | `drain`, `close`, `error`, none |
| event order | before callback, callback then event, event without callback |
| scheduler | same stack, microtask, timer, immediate |
| process phase | forwarding, repeatable `beforeExit`, one-shot `exit` |
| observer | healthy, failed before result, failed during terminal phase |
| evidence | absent before finalization, complete pair, publication failure |
| process outcome | exit `0`, exit `1`; exit `13` forbidden |

## Executable transition matrix

The `shared matrix` rows are executed from
`test/fixtures/wp6-authorization-output-lifecycle.mjs`. The named legacy rows
remain independent regression witnesses for redaction, filesystem atomicity,
listener counts, and post-evidence output.

| Transition | Expected | Witness |
| --- | --- | --- |
| native callback success | green pair / exit `0` | shared matrix `native-success` |
| `true` + synchronous callback success | green pair / exit `0` | shared matrix `callback-sync-success` |
| `true` + immediate callback success | green pair / exit `0` | shared matrix `callback-async-success` |
| `false` + callback success + `drain` | green pair / exit `0` | shared matrix `backpressure-drain-success` and paused-destination test |
| `true` + asynchronous callback error | failing pair / exit `1` | shared matrix `callback-async-error` and delayed-write-failure test |
| `true` + `close` + absent callback | failing pair / exit `1` | shared matrix `close-before-callback` and destination-close test |
| `true` + no callback/event | failing pair / exit `1`, never `13` | shared matrix `silent-accepted` and silent accepted test |
| `false` + no callback/event | failing pair / exit `1`, never `13` | shared matrix `silent-backpressured` and silent backpressured test |
| synchronous `write()` throw | failing pair / exit `1`, no waiter leak | shared matrix `synchronous-throw` and listener-cleanup test |
| callback success + microtask error | failing pair / exit `1` | shared matrix `post-callback-microtask-error` and post-callback test |
| callback success + timer error | failing pair / exit `1` | shared matrix `post-callback-timer-error` and delayed-lifecycle test |
| `beforeExit` + microtask error | failing pair / exit `1` | shared matrix `before-exit-microtask-error` |
| `beforeExit` + timer error + repeated `beforeExit` | failing pair / exit `1` | shared matrix `before-exit-timer-error` |
| `beforeExit` + immediate error + repeated `beforeExit` | failing pair / exit `1` | shared matrix `before-exit-immediate-error` |
| one-shot `exit` + synchronous error | failing pair / exit `1` | shared matrix `exit-sync-error` |
| failed sink receives later coordinator writes | zero later writes / exit `1` | failed-sink containment test |
| terminal evidence already exists | zero stdout/stderr writes afterward | terminal-evidence test |
| artifact publication fails | no readiness file / nonzero test failure | atomic-publication test |
| readiness publication fails | artifact manifest only / nonzero test failure | atomic-publication test |
| launch failure | failing pair / exit `1` | configured launch-failure test |
| missing external target | blocker pair / exit `1` | missing-target test |

## Completeness rule

A future output-lifecycle repair is incomplete unless it either preserves every
row above or adds a new row for the newly discovered equivalence class before
production changes. Review begins by auditing this matrix and its executable
scenario list for agreement; it does not begin from the latest defect alone.
