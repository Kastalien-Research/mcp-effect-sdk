interface FingerprintNode {
  readonly id: string
  readonly kind: string
  readonly config: unknown
}

interface FingerprintEdge {
  readonly id: string
  readonly kind: string
  readonly source: string
  readonly target: string
}

export interface GraphFingerprintInput {
  readonly nodes: ReadonlyArray<FingerprintNode>
  readonly edges: ReadonlyArray<FingerprintEdge>
}

const compareCodeUnits = (left: string, right: string): number =>
  left < right ? -1 : left > right ? 1 : 0

const canonicalize = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(canonicalize)
  if (typeof value !== "object" || value === null) return value

  return Object.fromEntries(
    Object.entries(value as Readonly<Record<string, unknown>>)
      .sort(([left], [right]) => compareCodeUnits(left, right))
      .map(([key, child]) => [key, canonicalize(child)]),
  )
}

const canonicalGraph = (graph: GraphFingerprintInput): string =>
  JSON.stringify({
    nodes: graph.nodes
      .map(node => ({ id: node.id, kind: node.kind, config: canonicalize(node.config) }))
      .toSorted((left, right) => compareCodeUnits(JSON.stringify(left), JSON.stringify(right))),
    edges: graph.edges
      .map(edge => ({
        id: edge.id,
        kind: edge.kind,
        source: edge.source,
        target: edge.target,
      }))
      .toSorted((left, right) => compareCodeUnits(JSON.stringify(left), JSON.stringify(right))),
  })

const fnv1a32 = (value: string): string => {
  let hash = 0x811c9dc5
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193)
  }
  return (hash >>> 0).toString(16).padStart(8, "0")
}

/** Compatibility identity for executable graph content; not a security or integrity hash. */
export const graphExecutionFingerprint = (graph: GraphFingerprintInput): string =>
  `graph-v2-${fnv1a32(canonicalGraph(graph))}`

export const withGraphRevision = <Graph extends GraphFingerprintInput>(
  graph: Graph,
): Graph & { readonly revision: string } => ({
  ...graph,
  revision: graphExecutionFingerprint(graph),
})
