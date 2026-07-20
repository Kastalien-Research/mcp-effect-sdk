# MCP Apps and IDE verification lanes

The MCP IDE has a focused Bun verifier, and the repository has a Node composite that keeps
fixture, SDK contract, repository-hygiene, and official-conformance claims separate. Both require
an absolute artifact directory outside the checkout. Neither command formats or repairs source.

## Focused IDE verification

Install the isolated `visual-effect` package with Bun, then run:

```bash
cd visual-effect
bun run verify:mcp-ide -- --artifact-dir /private/tmp/mcp-ide-artifacts
```

The verifier independently runs scoped Biome, TypeScript typecheck, the `src/mcp-ide` Vitest
suite, and the Next production build. A failed gate does not prevent later gates from running.
It writes `mcp-ide.json` and `logs/<gate>.{stdout,stderr}.log`. Report schema version `1` records
the commit, full command, working directory, exit code, duration, required flag, status, summary
counts, and failure excerpts. `fixtureHashes` is reserved for the canonical sanitized Apps
fixtures introduced by the fixture task.

## Composite verification

From the repository root:

```bash
node scripts/verify-apps-ide-lanes.mjs \
  --mode fixture \
  --artifact-dir /private/tmp/mcp-apps-ide-artifacts

node scripts/verify-apps-ide-lanes.mjs \
  --mode contract \
  --artifact-dir /private/tmp/mcp-apps-ide-artifacts \
  --strict-repo
```

`fixture` makes only the focused IDE/fixture lane required. `contract` also requires
`scripts/check-apps-contract.mjs`; until that future public Apps SDK contract verifier exists, the
gate is `not-configured` and the command exits non-zero. It never substitutes fixture replay for
SDK coverage.

The Visual Effect whole-application `CI=1 bun run verify` result is always retained as the
`repository-hygiene` baseline. It is optional by default because it currently includes unrelated
gallery examples; `--strict-repo` makes that selected baseline required. Optional failures remain
failed in the report even when they do not determine the exit code.

Add `--include-conformance` to run official server conformance as a separate, optional
qualification lane. Its evidence is redirected below the external artifact directory. The
composite records authorization conformance as `not-run: missing explicit target`; it does not
inspect secrets or invent a target. Authorization qualification requires a separately supplied
explicit target.

The composite writes:

```text
<artifact-dir>/summary.json
<artifact-dir>/summary.md
<artifact-dir>/mcp-ide/mcp-ide.json
<artifact-dir>/logs/<gate>.stdout.log
<artifact-dir>/logs/<gate>.stderr.log
```

Each JSON gate has an ID, lane, required flag, status, command, working directory, exit code,
duration, inputs, artifact paths, and a failure excerpt when applicable. `not-configured` is an
unmet required contract, not a pass.

## What each lane proves

| Lane | Meaning | Does not prove |
| --- | --- | --- |
| Fixture | Deterministic IDE graph/trace read-model behavior and the focused IDE build | Live Apps hosting or an SDK Apps API |
| SDK contract | The named local public Apps SDK contract test exists and passes | Published-package or extension qualification |
| Repository hygiene | Broader Visual Effect source checks pass | Protocol conformance |
| Extension qualification | Stable/preview extension-specific tests and interop evidence, when implemented | Official MCP conformance |
| Official conformance | The explicitly invoked upstream suite result | Authorization without an explicit target |

## Disposable-worktree operation

Commands produce `.next/`, `dist/`, test caches, and evidence. Run them in a disposable detached
worktree created from a committed revision, while keeping all report artifacts outside it:

```bash
repo="$(git rev-parse --show-toplevel)"
run="$(mktemp -d /private/tmp/mcp-effect-sdk-apps-verify.XXXXXX)"
git -C "$repo" worktree add --detach "$run/repo" HEAD
cd "$run/repo"
corepack enable
pnpm install --frozen-lockfile
(cd visual-effect && bun install --frozen-lockfile)
node scripts/verify-apps-ide-lanes.mjs --mode fixture --artifact-dir "$run/artifacts"
```

Copy or upload `$run/artifacts` before removing only the disposable worktree that this procedure
created. Never clean, reset, or delete state from the caller's checkout or shared dependency
caches.
