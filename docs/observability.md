# Observability and Effect DevTools

The SDK emits backend-independent Effect spans. Executable Node programs and the
visual app can optionally connect those spans to Effect DevTools; leaving the
environment variables unset keeps DevTools completely disabled.

## Connect DevTools

Start an Effect DevTools server that accepts WebSocket connections, then opt in
at the executable boundary:

```bash
MCP_EFFECT_DEVTOOLS_URL=ws://127.0.0.1:34437 pnpm run conformance:run
MCP_EFFECT_DEVTOOLS_URL=ws://127.0.0.1:34437 node dist/examples/everything-server.js
```

Node scripts and examples use `MCP_EFFECT_DEVTOOLS_URL`. The browser app uses a
public build-time variable:

```bash
cd apps/visual-effect
NEXT_PUBLIC_MCP_EFFECT_DEVTOOLS_URL=ws://127.0.0.1:34437 bun run dev
```

Only `ws:` and `wss:` URLs without embedded usernames or passwords are accepted.
An invalid configured URL fails at startup. A valid URL whose server is
unavailable reports the connection failure through the Effect runtime.

When a variable is absent or empty, the corresponding helper returns
`Layer.empty`: it does not construct a WebSocket, retry a connection, or add a
startup delay.

## Runtime ownership and flushing

Every Node executable has one `NodeRuntime.runMain` boundary. `runScript`
provides the optional DevTools layer, opens `mcp.script.run`, and remains scoped
until the program and layer finalizers finish. Subprocesses are interruptible
children under `mcp.script.command`. Script failures are Effect failures; the
helpers never call `process.exit` or assign `process.exitCode`.

Examples use the equivalent scoped `runExample` boundary and `mcp.example.run`.
HTTP handlers either capture the owning Effect runtime or own one `toWebHandler`
managed runtime with an explicit disposal function.

The visual app owns one browser `ManagedRuntime`, shared through React context
and a global symbol so Strict Mode and hot reload do not create parallel
runtimes. Unmount interrupts runtime-owned fibers and disposal waits for runtime
finalizers. Business operations add their named spans before they are submitted
to the shared runtime.

These ownership rules matter for DevTools delivery: a successful, failed, or
interrupted root stays alive until ended spans have been exported and the
DevTools layer has disposed.

## Span hierarchy

A typical client request and retry trace is:

```text
mcp.script.run or mcp.example.run
  mcp.client.request / mcp.client.tool.call
    mcp.client.dispatch            one per MRTR round
      mcp.transport.send
      mcp.transport.receive
```

On the server:

```text
mcp.transport.receive
  mcp.server.dispatch
    handler work
    mcp.transport.send             terminal response remains a child
```

The stable SDK catalog also includes:

- `mcp.client.progress`
- `mcp.auth.token.exchange`
- `mcp.auth.bearer.verify`
- `mcp.auth.scope.policy`

The IDE’s named operation spans include:

- `mcp.ide.template.instantiate`
- `mcp.ide.graph.command`
- `mcp.ide.project.compile`
- `mcp.ide.project.render`
- `mcp.ide.document.import`
- `mcp.ide.document.export`
- `mcp.ide.trace.replay`

## Safe attributes

Attributes are bounded and allowlisted. They may include the protocol method,
normalized request ID, `http`/`stdio` transport kind, a bounded operation name,
grant type, and MRTR round or status.

Spans must never contain message bodies, results, tool arguments, headers,
tokens, authorization codes, full URIs, filesystem paths, command-line
arguments, environments, working directories, or subprocess output. Resource
telemetry uses no raw resource identifier. Stack capture is disabled on stable
protocol spans.

## Using the boundaries

Scripts compose effects and yield subprocesses from the shared root:

```js
NodeRuntime.runMain(
  runScript(
    "check:example",
    runCommand("pnpm", ["run", "build"], root, {
      label: "build"
    })
  )
)
```

Clients and servers require no DevTools dependency in published `src/`; their
logical and transport spans are always available to whichever tracer the caller
provides. Runnable examples install DevTools only in
`examples/internal/DevTools.ts`.

Browser components call `useBrowserEffectRuntime()` and use `runSync`,
`runPromise`, or `runFork`. Named spans belong in the invoked business Effect,
not in React render functions.

## Coverage evidence

[`observability-inventory.json`](observability-inventory.json) records exact
source paths. `coveredByParentBoundary` entries name the precise boundary file
and span. The coverage gate parses source to verify real call expressions,
rejects comment-only markers and nested root runtimes, and permits broad rules
only for generated code and static public assets:

```bash
pnpm run generate:observability-inventory
pnpm run check:observability-coverage
pnpm run test:observability
```

If no spans appear, first confirm that the correct Node or browser variable is
present in the process that creates the runtime—not only in a parent shell or a
different build. If startup rejects the URL, check the scheme and remove any
userinfo. If connection attempts fail, confirm the DevTools listener address,
port, and browser mixed-content policy (`wss:` is normally required from an
HTTPS page).
