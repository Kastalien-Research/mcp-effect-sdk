# Changelog

All notable changes to this project are documented here.

The format follows Keep a Changelog and the package follows Semantic Versioning.

## [Unreleased]

No changes have been assigned to a post-`1.0.0` release.

## [1.0.0] - Pending publication

This section prepares the first stable release. It is not evidence that `1.0.0`
has been tagged, published, or approved for an MCP SDK Tier.

### Added

- Effect-native MCP client and server APIs.
- Stdio and Streamable HTTP transports.
- Tools, resources, prompts, completion, scoped subscriptions, progress,
  cancellation, caching, and JSON Schema 2020-12 support.
- MRTR handling for elicitation, sampling, and roots input.
- OAuth client and protected-resource authorization boundaries.
- Generated protocol and Effect Schema exports for MCP `2026-07-28`.
- Effect-native tracing spans at server and client protocol dispatch boundaries,
  with stable public span names and protocol-only attributes.
- Graceful terminal subscription responses for explicit HTTP and stdio shutdown.
- Issuer-defined authorization scope satisfaction with exact-match defaults and
  contained policy failures.
- Opt-in deprecated logging with request-owned delivery and severity filtering.
- A schema-derived feature coverage matrix, released Tier policy checks, exact
  label synchronization, and timeline-based maintenance evidence.

### Changed

- Finalized source generation against the released MCP `2026-07-28`
  specification at its exact stable commit and dated paths.
- Replaced draft conformance adjudications with fail-closed, same-commit server,
  client, and client-auth evidence from the pinned official harness.
- Made final generated schemas authoritative for low-level client metadata,
  discovery results, subscription terminal envelopes, and protocol parity.

### Fixed

- Argument-less tools now advertise a strict empty-object input schema instead
  of a top-level `anyOf` that some model providers reject.
- The build now fails on TypeScript errors, examples build from their own
  configuration, and stale SDK-port examples are excluded.
- Published package contents use an explicit allowlist and carry the matching
  MIT license metadata and files.

### Removed

- The `2025-11-25` initialize/session lifecycle and legacy HTTP+SSE,
  standalone-SSE, and WebSocket transports.

[Unreleased]:
  https://github.com/Kastalien-Research/mcp-effect-sdk/compare/main...HEAD
