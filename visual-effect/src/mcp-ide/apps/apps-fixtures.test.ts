import { readFileSync } from "node:fs"
import path from "node:path"
import { Effect, Either } from "effect"
import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"
import { makeProjectBundle, serializeProjectBundle } from "../authoring/McpProjectBundleIO"
import { withGraphRevision } from "../model/GraphFingerprint"
import type { McpTraceDocument } from "../model/McpTraceDocument"
import { AppLifecyclePanel } from "./AppLifecyclePanel"
import {
  type AppsPublicEventSource,
  AppsTraceAdapterError,
  adaptAppsPublicEventSource,
  decodeAppsPublicSession,
} from "./AppsTraceAdapter"

const stableSource = readFileSync(
  path.resolve(process.cwd(), "..", "fixtures/mcp-apps/v1/stable-view-lifecycle.json"),
  "utf8",
)
const previewSource = readFileSync(
  path.resolve(process.cwd(), "..", "fixtures/mcp-apps/v1/preview-host-lifecycle.json"),
  "utf8",
)

const parseFixture = (source: string): unknown => JSON.parse(source) as unknown

interface MutableAppsFixture extends Record<string, unknown> {
  contract: Record<string, unknown>
  provenance: Record<string, unknown>
  graph: Record<string, unknown> & {
    nodes: Array<{ id: string; kind: string; config: Record<string, unknown> }>
    edges: Array<{ id: string; kind: string; source: string; target: string }>
  }
  resource: Record<string, unknown> & { linkedNodeIds: Array<string> }
  events: Array<Record<string, unknown> & { policy: Record<string, unknown> }>
}

const mutableStableFixture = (): MutableAppsFixture =>
  parseFixture(stableSource) as MutableAppsFixture

const expectTypedAdapterFailure = (candidate: unknown): void => {
  let result: Either.Either<unknown, unknown> | undefined
  expect(() => {
    result = Effect.runSync(decodeAppsPublicSession(candidate).pipe(Effect.either))
  }).not.toThrow()
  expect(result).toBeDefined()
  expect(Either.isLeft(result as Either.Either<unknown, unknown>)).toBe(true)
  if (result && Either.isLeft(result)) {
    expect(result.left).toBeInstanceOf(AppsTraceAdapterError)
  }
}

describe("canonical Apps fixture contracts", () => {
  it.each([
    ["stable", stableSource],
    ["preview", previewSource],
  ] as const)("decodes and normalizes the explicit %s profile fixture", (profile, source) => {
    const fixture = Effect.runSync(decodeAppsPublicSession(parseFixture(source)))
    const trace = Effect.runSync(fixture.normalize())

    expect(fixture.profile).toBe(profile)
    expect(fixture.extensionId).toBe("io.modelcontextprotocol/ui")
    expect(trace).toMatchObject({
      schemaVersion: "2",
      graphId: fixture.graph.id,
      graphRevision: fixture.graph.revision,
    })
    expect(trace.events.length).toBeGreaterThanOrEqual(5)
    expect(trace.events.every(event => event.family === "apps" && event.channel === "apps")).toBe(
      true,
    )
  })

  it("requires stable constants while leaving preview explicitly unqualified", () => {
    const stable = Effect.runSync(decodeAppsPublicSession(parseFixture(stableSource)))
    const preview = Effect.runSync(decodeAppsPublicSession(parseFixture(previewSource)))

    expect(stable.contract).toEqual({
      status: "stable-profile-fixture",
      mimeType: "text/html;profile=mcp-app",
      uiProtocolVersion: "2026-01-26",
    })
    expect(preview.contract).toEqual({
      status: "unqualified",
      reason: "fixture data pending accepted WP9",
    })
    expect(JSON.stringify(preview)).not.toMatch(/uiProtocolVersion|protocolRevision/)
  })

  it.each([
    ["missing profile", (value: Record<string, unknown>) => delete value.profile],
    [
      "unknown profile",
      (value: Record<string, unknown>) => Object.assign(value, { profile: "ui" }),
    ],
    [
      "extension id inference",
      (value: Record<string, unknown>) => {
        delete value.profile
        Object.assign(value, { extensionId: "io.modelcontextprotocol/ui" })
      },
    ],
  ] as const)("rejects %s instead of inferring a profile", (_label, mutate) => {
    const candidate = parseFixture(stableSource) as Record<string, unknown>
    mutate(candidate)

    expect(
      Either.isLeft(Effect.runSync(decodeAppsPublicSession(candidate).pipe(Effect.either))),
    ).toBe(true)
  })

  it("rejects graph profile mismatch and contradictory policy outcomes", () => {
    const graphMismatch = parseFixture(stableSource) as Record<string, unknown>
    graphMismatch.profile = "preview"
    graphMismatch.contract = {
      status: "unqualified",
      reason: "fixture data pending accepted WP9",
    }

    const contradictory = parseFixture(previewSource) as {
      events: Array<Record<string, unknown>>
    }
    const denied = contradictory.events.find(event => event.kind === "apps.consent-denied")
    if (!denied) throw new Error("preview fixture must include denied consent")
    denied.kind = "apps.consent-allowed"

    expect(
      Either.isLeft(Effect.runSync(decodeAppsPublicSession(graphMismatch).pipe(Effect.either))),
    ).toBe(true)
    expect(
      Either.isLeft(Effect.runSync(decodeAppsPublicSession(contradictory).pipe(Effect.either))),
    ).toBe(true)
  })

  it("fails typed when a public source contains a cyclic non-portable graph", () => {
    const candidate = parseFixture(stableSource) as Record<string, unknown>
    const cyclic: Record<string, unknown> = {}
    cyclic.self = cyclic
    candidate.graph = cyclic

    const result = Effect.runSync(decodeAppsPublicSession(candidate).pipe(Effect.either))
    expect(Either.isLeft(result)).toBe(true)
    if (Either.isLeft(result)) expect(result.left._tag).toBe("AppsTraceAdapterError")
  })

  it("adapts through a fake public event source without SDK-private imports", () => {
    const fake: AppsPublicEventSource = {
      read: Effect.succeed(parseFixture(stableSource)),
    }
    const result = Effect.runSync(adaptAppsPublicEventSource(fake))

    expect(result.graph).toMatchObject({ id: "apps-stable-view-fixture" })
    expect(result.trace.events.map(event => event.kind)).toEqual([
      "apps.resource-linked",
      "apps.view-loading",
      "apps.consent-allowed",
      "apps.policy-allowed",
      "apps.view-ready",
      "apps.view-closed",
    ])
  })

  it("carries only sanitized semantic data at the adapter boundary", () => {
    const result = Effect.runSync(
      adaptAppsPublicEventSource({ read: Effect.succeed(parseFixture(previewSource)) }),
    )
    const serialized = JSON.stringify(result)

    expect(serialized).not.toMatch(
      /<html|authorization|credential|token|origin|headers|taskHandle/i,
    )
    expect(result.trace.events.every(hasExplicitAppsPayload)).toBe(true)
  })

  it("renders the preview profile and denied outcomes without inferring Host availability", () => {
    const result = Effect.runSync(
      adaptAppsPublicEventSource({ read: Effect.succeed(parseFixture(previewSource)) }),
    )
    const markup = renderToStaticMarkup(
      createElement(AppLifecyclePanel, {
        trace: result.trace,
        onSelectEvent: () => undefined,
      }),
    )

    expect(markup).toContain("UNQUALIFIED PREVIEW")
    expect(markup).toContain("CONSENT DENIED")
    expect(markup).toContain("POLICY DENIED")
    expect(markup).toContain("No current Host, View, or negotiated state is inferred")
    expect(markup).not.toContain("HOST READY")
  })

  describe("frozen ownership boundary matrix", () => {
    it("accepts an exact own-data-property root record", () => {
      expect(
        Either.isRight(
          Effect.runSync(decodeAppsPublicSession(mutableStableFixture()).pipe(Effect.either)),
        ),
      ).toBe(true)
    })

    it("rejects own extra root keys", () => {
      const candidate = mutableStableFixture()
      candidate.extra = true
      expectTypedAdapterFailure(candidate)
    })

    it("ignores inherited irrelevant root keys", () => {
      const candidate = mutableStableFixture()
      Object.setPrototypeOf(candidate, { irrelevant: true })
      expect(
        Either.isRight(Effect.runSync(decodeAppsPublicSession(candidate).pipe(Effect.either))),
      ).toBe(true)
    })

    it("accepts null-prototype records with exact own data properties", () => {
      const candidate = Object.assign(
        Object.create(null) as Record<string, unknown>,
        mutableStableFixture(),
      )
      expect(
        Either.isRight(Effect.runSync(decodeAppsPublicSession(candidate).pipe(Effect.either))),
      ).toBe(true)
    })

    it("rejects an own __proto__ extra key", () => {
      const candidate = mutableStableFixture()
      Object.defineProperty(candidate, "__proto__", {
        enumerable: true,
        value: { polluted: true },
      })
      expectTypedAdapterFailure(candidate)
    })

    it.each([
      ["root", (candidate: MutableAppsFixture) => Object.create(candidate) as unknown],
      [
        "contract",
        (candidate: MutableAppsFixture) => {
          candidate.contract = Object.create(candidate.contract) as Record<string, unknown>
          return candidate
        },
      ],
      [
        "provenance",
        (candidate: MutableAppsFixture) => {
          candidate.provenance = Object.create(candidate.provenance) as Record<string, unknown>
          return candidate
        },
      ],
      [
        "resource",
        (candidate: MutableAppsFixture) => {
          candidate.resource = Object.create(candidate.resource) as MutableAppsFixture["resource"]
          return candidate
        },
      ],
      [
        "event",
        (candidate: MutableAppsFixture) => {
          const event = candidate.events[0]
          if (!event) throw new Error("stable fixture must include an event")
          candidate.events[0] = Object.create(event) as MutableAppsFixture["events"][number]
          return candidate
        },
      ],
      [
        "policy",
        (candidate: MutableAppsFixture) => {
          const event = candidate.events[0]
          if (!event) throw new Error("stable fixture must include an event")
          event.policy = Object.create(event.policy) as Record<string, unknown>
          return candidate
        },
      ],
    ] as const)("rejects inherited required values at the %s boundary", (_label, mutate) => {
      expectTypedAdapterFailure(mutate(mutableStableFixture()))
    })

    it.each([
      [
        "root profile",
        (candidate: MutableAppsFixture) => {
          Object.defineProperty(candidate, "profile", {
            enumerable: true,
            get: () => {
              throw new Error("hostile root getter")
            },
          })
          return candidate
        },
      ],
      [
        "event summary",
        (candidate: MutableAppsFixture) => {
          const event = candidate.events[0]
          if (!event) throw new Error("stable fixture must include an event")
          Object.defineProperty(event, "summary", {
            enumerable: true,
            get: () => {
              throw new Error("hostile event getter")
            },
          })
          return candidate
        },
      ],
    ] as const)("fails typed without invoking a %s accessor", (_label, mutate) => {
      expectTypedAdapterFailure(mutate(mutableStableFixture()))
    })
  })

  it("rejects duplicate linked node ids", () => {
    const candidate = mutableStableFixture()
    const firstLinkedNodeId = candidate.resource.linkedNodeIds[0]
    if (!firstLinkedNodeId) throw new Error("stable fixture must link at least one node")
    candidate.resource.linkedNodeIds.push(firstLinkedNodeId)

    expectTypedAdapterFailure(candidate)
  })

  it("rejects secret-bearing UI URIs before graph, trace, bundle, or UI projection", () => {
    const rawSecret = "RAW_APPS_URI_SECRET"
    const secretUri = `ui://user:${rawSecret}@field-operations/observations?token=${rawSecret}#${rawSecret}`
    const candidate = mutableStableFixture()
    candidate.resource.uri = secretUri
    const resourceNode = candidate.graph.nodes.find(node => node.kind === "app-resource")
    if (!resourceNode) throw new Error("stable fixture must include an app resource node")
    resourceNode.config.uri = secretUri
    candidate.graph = withGraphRevision(candidate.graph)

    const observed = { graph: "", trace: "", bundle: "", ui: "" }
    const result = Effect.runSync(
      adaptAppsPublicEventSource({ read: Effect.succeed(candidate) }).pipe(
        Effect.tap(adapted =>
          Effect.sync(() => {
            observed.graph = JSON.stringify(adapted.graph)
            observed.trace = JSON.stringify(adapted.trace)
            observed.ui = renderToStaticMarkup(
              createElement(AppLifecyclePanel, {
                trace: adapted.trace,
                onSelectEvent: () => undefined,
              }),
            )
          }),
        ),
        Effect.flatMap(adapted => makeProjectBundle(adapted.graph, adapted.trace)),
        Effect.flatMap(bundle =>
          serializeProjectBundle(bundle).pipe(
            Effect.tap(serialized =>
              Effect.sync(() => {
                observed.bundle = serialized
              }),
            ),
          ),
        ),
        Effect.either,
      ),
    )

    expect(Either.isLeft(result)).toBe(true)
    if (Either.isLeft(result)) expect(result.left).toBeInstanceOf(AppsTraceAdapterError)
    expect(JSON.stringify({ result, observed })).not.toContain(rawSecret)
    expect(observed).toEqual({ graph: "", trace: "", bundle: "", ui: "" })
  })
})

function hasExplicitAppsPayload(event: McpTraceDocument["events"][number]): boolean {
  const payload = event.payload as Record<string, unknown>
  const resource = payload.resource as Record<string, unknown> | undefined
  const policy = payload.policy as Record<string, unknown> | undefined
  const provenance = payload.provenance as Record<string, unknown> | undefined
  return (
    (payload.profile === "stable" || payload.profile === "preview") &&
    typeof resource?.uri === "string" &&
    typeof resource?.nodeId === "string" &&
    Array.isArray(resource?.linkedNodeIds) &&
    typeof event.correlationId === "string" &&
    typeof policy?.kind === "string" &&
    typeof policy?.outcome === "string" &&
    provenance?.source === "declared-fixture"
  )
}
