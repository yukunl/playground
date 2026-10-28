// Shapes the BFF returns from /api/models and /api/health.

export type UpstreamKind = 'mock' | 'parasail'

export type ModelPricing = {
  inputPerMtokUsd: number
  outputPerMtokUsd: number
  /** The cheaper rate for prompt tokens served from the provider's cache. */
  cacheReadPerMtokUsd?: number
}

export type Model = {
  id: string
  /** Friendly name from our model table, when we know the model. */
  name?: string
  /** In our model table: shown first in the picker, in table order. */
  featured: boolean
  ownedBy?: string
  contextLength?: number
  /** null when neither the API nor our table has a price. */
  pricing: ModelPricing | null
  /** Where the price came from: the API itself (the mock), or our table (copied list prices). */
  priceSource?: 'api' | 'table'
}

export type ModelsResponse = {
  data: Model[]
  fetchedAt: string
  /** True when the upstream failed and this is the last list we had. */
  stale: boolean
  /** The date the table's list prices were copied, when any model uses them. */
  pricesAsOf?: string
}

export type Health = {
  ok: true
  version: string
  /** What the last model-list refresh found. Informational: it never fails the health check. */
  upstream: 'ok' | 'unreachable' | 'unknown'
  upstreamKind: UpstreamKind
  /** Whether `?_simulate` and the fault switches work on this server (PLAYGROUND_FAULTS). */
  faultsEnabled: boolean
}
