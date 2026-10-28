import type { Model, ModelPricing } from '../../shared/models'
import { MODEL_TABLE, NON_CHAT_ID, type ModelEntry } from '../model-table'

/** One model as the live /v1/models list described it. */
export type LiveModel = {
  id: string
  ownedBy?: string
  contextLength?: number
  capabilities?: string[]
  pricing: ModelPricing | null
}

/**
 * Combines the live list with our model table (design §23.4):
 * - live and in the table → featured, with our name and price; aliases collapse into one row;
 * - live but not in the table → "other", still usable, no price unless the API gave one;
 * - non-chat models → hidden;
 * - in the table but not live → hidden (retired).
 * The API's own metadata always wins over the table (the mock sends prices and context sizes).
 */
export function joinModels(live: LiveModel[], table: ModelEntry[] = MODEL_TABLE): Model[] {
  const byId = new Map(live.map((m) => [m.id, m]))
  const claimed = new Set<string>()
  const featured: Model[] = []

  for (const entry of table) {
    const liveIds = [entry.id, ...(entry.aliases ?? [])].filter((id) => byId.has(id))
    for (const id of liveIds) claimed.add(id)
    if (entry.kind !== 'chat' || liveIds.length === 0) continue

    // Send our ID when it's live; if only an alias is, send that.
    const sendId = byId.has(entry.id) ? entry.id : liveIds[0]!
    const api = byId.get(sendId)!
    featured.push({
      id: sendId,
      name: entry.name,
      featured: true,
      ...(api.ownedBy ? { ownedBy: api.ownedBy } : {}),
      ...withContext(api.contextLength ?? entry.contextLength),
      ...withPricing(api.pricing, entry.pricing),
    })
  }

  const others = live
    .filter((m) => !claimed.has(m.id) && isChat(m))
    .sort((a, b) => a.id.localeCompare(b.id, 'en', { sensitivity: 'base' }))
    .map(
      (m): Model => ({
        id: m.id,
        featured: false,
        ...(m.ownedBy ? { ownedBy: m.ownedBy } : {}),
        ...withContext(m.contextLength),
        ...withPricing(m.pricing, undefined),
      }),
    )

  return [...featured, ...others]
}

/** If the API says what a model can do, trust it; otherwise go by the ID. */
function isChat(m: LiveModel): boolean {
  return m.capabilities ? m.capabilities.includes('chat') : !NON_CHAT_ID.test(m.id)
}

function withContext(contextLength: number | undefined) {
  return contextLength ? { contextLength } : {}
}

function withPricing(api: ModelPricing | null, table: ModelPricing | undefined) {
  if (api) return { pricing: api, priceSource: 'api' as const }
  if (table) return { pricing: table, priceSource: 'table' as const }
  return { pricing: null }
}
