import { z } from 'zod'
import type { Model } from '../../shared/models'
import { callUpstream, readUpstreamMessage, type UpstreamDeps } from './client'
import { joinModels, type LiveModel } from './join-models'
import { badUpstreamResponse, translateUpstreamStatus, UpstreamFailure, upstreamUnreachable } from './translate-error'

const CACHE_TTL_MS = 5 * 60_000
const FETCH_TIMEOUT_MS = 10_000

// Loose on purpose: unknown fields are ignored, and only `id` is required.
const UpstreamModel = z.looseObject({
  id: z.string(),
  owned_by: z.string().optional(),
  context_length: z.number().optional(),
  capabilities: z.array(z.string()).optional(),
  pricing: z
    .looseObject({ input_per_mtok_usd: z.number(), output_per_mtok_usd: z.number() })
    .optional(),
})
const UpstreamModelList = z.looseObject({ data: z.array(UpstreamModel) })

type Snapshot = { models: Model[]; fetchedAt: number }
export type ModelList = Snapshot & { stale: boolean }

/**
 * The chat models (the live list combined with our model table), cached for 5
 * minutes. Concurrent refreshes share one upstream call, and if a refresh fails,
 * the last good list is served as stale.
 */
export class ModelCatalog {
  private cached?: Snapshot
  private inflight?: Promise<Snapshot>
  private lastRefresh: 'ok' | 'failed' | 'never' = 'never'

  constructor(private readonly deps: UpstreamDeps & { now: () => number }) {}

  async list(requestId: string): Promise<ModelList> {
    if (this.cached && this.deps.now() - this.cached.fetchedAt < CACHE_TTL_MS) {
      return { ...this.cached, stale: false }
    }
    try {
      return { ...(await this.refresh(requestId)), stale: false }
    } catch (err) {
      if (this.cached && err instanceof UpstreamFailure) return { ...this.cached, stale: true }
      throw err
    }
  }

  /** `_simulate` has to reach the upstream every time, so it skips the cache entirely. */
  async listSimulated(requestId: string, simulate: number): Promise<ModelList> {
    return { ...(await this.fetchOnce(requestId, simulate)), stale: false }
  }

  /** For /api/health: what the last real refresh found. */
  upstreamStatus(): 'ok' | 'unreachable' | 'unknown' {
    if (this.lastRefresh === 'ok') return 'ok'
    if (this.lastRefresh === 'failed') return 'unreachable'
    return 'unknown'
  }

  /** Refresh in the background if the cache is cold or old. Never throws. */
  warm(requestId: string): void {
    this.list(requestId).catch(() => {})
  }

  private refresh(requestId: string): Promise<Snapshot> {
    this.inflight ??= this.fetchOnce(requestId)
      .then(
        (snapshot) => {
          this.cached = snapshot
          this.lastRefresh = 'ok'
          return snapshot
        },
        (err: unknown) => {
          this.lastRefresh = 'failed'
          throw err
        },
      )
      .finally(() => {
        this.inflight = undefined
      })
    return this.inflight
  }

  private async fetchOnce(requestId: string, simulate?: number): Promise<Snapshot> {
    const ctx = { requestId, op: 'models' as const }

    let res: Response
    try {
      res = await callUpstream(this.deps, '/v1/models', {
        requestId,
        simulate,
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      })
    } catch (err) {
      throw upstreamUnreachable(err, ctx)
    }

    if (!res.ok) {
      throw translateUpstreamStatus(res.status, res.headers, await readUpstreamMessage(res), ctx, this.deps.now())
    }

    const parsed = UpstreamModelList.safeParse(await res.json().catch(() => undefined))
    if (!parsed.success) throw badUpstreamResponse(ctx)

    const live = parsed.data.data.map(
      (m): LiveModel => ({
        id: m.id,
        ownedBy: m.owned_by,
        contextLength: m.context_length || undefined,
        capabilities: m.capabilities,
        pricing: m.pricing
          ? { inputPerMtokUsd: m.pricing.input_per_mtok_usd, outputPerMtokUsd: m.pricing.output_per_mtok_usd }
          : null,
      }),
    )
    return { models: joinModels(live), fetchedAt: this.deps.now() }
  }
}
