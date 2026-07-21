# Extension reconciliation against MCP 2026-07-28

This record fixes precedence between the frozen MCP core, Tasks, and Apps inputs. It is an implementation contract for later work packages, not evidence that the extension runtimes are implemented or conformant.

## Binding precedence

1. The pinned core TypeScript schema and normative core prose control core behavior.
2. A pinned extension specification controls only its extension surface. MCP core `2026-07-28` wins where copied core types or extension examples lag.
3. The pinned official conformance harness verifies behavior but cannot override the specification.
4. TypeScript SDK v2 is a differential design oracle only.
5. Effect-native APIs may improve ergonomics but cannot change the wire contract.

## Tasks overlay

Tasks overlays core `2026-07-28`. Missing capabilities map to JSON-RPC `-32021` and HTTP 400. Every augmented core request includes mandatory core `_meta`; task subscriptions add core subscription metadata; and every result union keeps literal `resultType` discriminators. Stale extension copies of core request or result types are not imported as authority.

## Apps profiles

Stable Apps `2026-01-26` and the pinned preview both use `io.modelcontextprotocol/ui`; the identifier alone never selects behavior. Every Host/View session receives an explicit profile and rejects methods that are outside it.

Host-to-server Apps negotiation uses modern per-request metadata and `server/discover`, never legacy core `initialize`. App-to-Host remains the separate Apps postMessage dialect: `ui/initialize` followed by `ui/notifications/initialized`.

Core readiness, Tasks readiness, Apps stable readiness, Apps preview readiness, release readiness, and official Tier designation remain separate claims.
