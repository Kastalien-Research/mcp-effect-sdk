## Probe Before Building

Before writing code whose DESIGN rests on the runtime shape of an external API —
an AST layout, a variant schema, a layer config, a wire format — spend ten
minutes running a throwaway scratch script that prints the actual shapes. Then
design against what printed, not what the docs or your memory imply.

This is verify-before-writing extended from names (packages, flags, endpoints)
to shapes and behavior. A name that doesn't exist fails loudly on first run; a
shape you assumed wrong fails quietly, later, in whatever you built on top of
it.

### The observed payoff (2026-07-17)

The run-ledger DDL derivation was designed to detect integer columns via
`Schema.IntSchemaId` on the encoded AST. A 30-line probe script run BEFORE any
ledger code existed showed that refinements do not survive `AST.encodedAST` —
`Schema.Int` encodes to a bare `NumberKeyword` — so Int detection had to walk
the type side instead. The design was corrected pre-code; the subsequent
~10-file package typechecked on the first pass with a single runtime fix (nested
unions). Without the probe, that premise would have failed deep inside a
written-and-tested walker.

### Same rule, internal artifacts (2026-07-17 evening)

The discipline extends to artifacts we own. The dispatch routing interpreter's
test suite (`test/dispatch-routing.test.ts`) decodes the LIVE
`data/workflow-configs.json` — not a fixture — and pins known-good dispatches.
On its first run it proved that literal `match.event_type` semantics made
model-drift-monitor's `signal-resolved` entry unreachable; the interpretation
was fixed before any dispatch service existed. When code interprets a config,
make the test suite consume the real config.

### The rule

1. Identify the load-bearing shape assumptions in the design (the plan's "risks"
   section usually names them).
2. Write a minimal scratch script that constructs the real objects and prints
   the real shapes. Run it against the actually-installed versions.
3. Fix the design first, delete the scratch, then build.

Skip only when the design touches no external shapes, or the shape is already
pinned by a test in this repo.
