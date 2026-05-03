# SDK Tier Evidence

## Current evidenced tier

Tier 3.

The SDK has generated protocol surfaces, task runtime checks, and an
Everything-style example server, but Phase 6 has not yet recorded a passing
conformance run. The README must not claim Tier 2, Tier 1, full conformance, or
production readiness until this file records the supporting results.

## Reproducible command

```bash
pnpm run verify
pnpm run conformance:run
```

If `../conformance/dist/index.js` is missing:

```bash
npm --prefix ../conformance ci
npm --prefix ../conformance run build
pnpm run conformance:run
```

## Source inputs

- `../modelcontextprotocol/seps/1730-sdks-tiering-system.md`
- `../conformance/src/scenarios/server/**`
- `../conformance/src/tier-check/**`
- `src/examples/everything-server.ts`
- `docs/conformance/scenario-map.md`
- `docs/conformance/dependency-update-policy.md`
- `docs/conformance/versioning-policy.md`

## Conformance coverage

Latest local Phase 6 run:

- Command: `pnpm run conformance:run`
- Date: 2026-05-03
- Suite: active server scenarios
- Result: 23 checks passed, 8 checks failed as expected by
  `docs/conformance/expected-failures.yml`
- Unexpected failures: 0
- Stale expected-failure entries: 0

The expected-failures baseline is part of the evidence. New failures fail the
command. If a baseline scenario starts passing, the command fails until the
baseline is updated.

## Tier blockers

- Eight active conformance checks remain in the expected-failures baseline.
- No published stable package release evidence.
- Documentation is basic and still being completed in Phase 6.

## Tier 2 evidence requirements

- At least 80 percent conformance coverage.
- At least one stable release.
- Basic documentation covering core features.
- Published dependency update policy.
- Roadmap toward Tier 1 or transparent Tier 2 direction.

## Tier 1 evidence requirements

- 100 percent conformance coverage.
- Full protocol support.
- Stable release and versioning policy.
- Examples for all features.
- Published dependency update policy.
