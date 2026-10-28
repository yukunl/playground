import { describe, expect, it } from 'vitest'
import { costUsd } from '../../src/shared/chat'
import type { ModelEntry } from '../../src/server/model-table'
import { joinModels, type LiveModel } from '../../src/server/upstream/join-models'
import { defaultModel } from '../../src/client/use-models'

const price = { inputPerMtokUsd: 0.22, cacheReadPerMtokUsd: 0.11, outputPerMtokUsd: 0.5 }

const table: ModelEntry[] = [
  { id: 'parasail-llama-33-70b-fp8', aliases: ['meta-llama/Llama-3.3-70B-Instruct'], name: 'Llama 3.3 70B', kind: 'chat', pricing: price },
  { id: 'parasail-gpt-oss-20b', aliases: ['openai/gpt-oss-20b'], name: 'gpt-oss 20B', kind: 'chat' },
  { id: 'parasail-retired-model', name: 'Retired', kind: 'chat', pricing: price },
  { id: 'parasail-bge-m3', aliases: ['BAAI/bge-m3'], name: 'BGE-M3', kind: 'embedding' },
]

/** The real API: IDs only, no metadata. */
const live = (...ids: string[]): LiveModel[] => ids.map((id) => ({ id, ownedBy: 'owner', pricing: null }))

describe('joinModels against the real API (IDs only)', () => {
  const result = joinModels(
    live(
      'zeta/Some-New-Model',
      'parasail-llama-33-70b-fp8',
      'meta-llama/Llama-3.3-70B-Instruct',
      'openai/gpt-oss-20b', // only the alias is live for this one
      'parasail-bge-m3',
      'BAAI/bge-m3',
      'parasail-text-embedding-small', // unknown, but looks like embeddings
      'parasail-resemble-tts-en', // unknown here, looks like speech
      'alpha-model',
    ),
    table,
  )

  it('features table models in table order, with our names and prices, aliases collapsed', () => {
    expect(result.filter((m) => m.featured)).toEqual([
      { id: 'parasail-llama-33-70b-fp8', name: 'Llama 3.3 70B', featured: true, ownedBy: 'owner', pricing: price, priceSource: 'table' },
      { id: 'openai/gpt-oss-20b', name: 'gpt-oss 20B', featured: true, ownedBy: 'owner', pricing: null },
    ])
  })

  it('lists unknown chat models after, alphabetically, with no price', () => {
    expect(result.filter((m) => !m.featured).map((m) => m.id)).toEqual(['alpha-model', 'zeta/Some-New-Model'])
    expect(result.find((m) => m.id === 'alpha-model')).toEqual({ id: 'alpha-model', featured: false, ownedBy: 'owner', pricing: null })
  })

  it('hides non-chat models (known from the table, or by the look of the ID) and retired ones', () => {
    const ids = result.map((m) => m.id)
    for (const hidden of ['parasail-bge-m3', 'BAAI/bge-m3', 'parasail-text-embedding-small', 'parasail-resemble-tts-en', 'meta-llama/Llama-3.3-70B-Instruct', 'parasail-retired-model']) {
      expect(ids).not.toContain(hidden)
    }
  })
})

describe('joinModels against the mock (which sends its own metadata)', () => {
  it('lets the API’s prices, context sizes and capabilities win, in one plain list', () => {
    const result = joinModels(
      [
        { id: 'parasail-llama-3.1-8b-instruct', contextLength: 131072, capabilities: ['chat'], pricing: { inputPerMtokUsd: 0.05, outputPerMtokUsd: 0.1 } },
        { id: 'parasail-whisper-large-v3', capabilities: ['audio_transcription'], pricing: null },
      ],
      table,
    )
    expect(result).toEqual([
      { id: 'parasail-llama-3.1-8b-instruct', featured: false, contextLength: 131072, pricing: { inputPerMtokUsd: 0.05, outputPerMtokUsd: 0.1 }, priceSource: 'api' },
    ])
  })
})

describe('costUsd with cached prompt tokens', () => {
  it('charges cached tokens at the cache-read rate', () => {
    // 1,000 prompt tokens of which 600 cached, 200 output, on Llama 3.3 70B list prices.
    const cost = costUsd({ promptTokens: 1000, completionTokens: 200, cachedTokens: 600 }, price)!
    expect(cost).toBeCloseTo((400 * 0.22 + 600 * 0.11 + 200 * 0.5) / 1_000_000, 12)
  })

  it('falls back to the input rate when there is no cache-read price', () => {
    const cost = costUsd({ promptTokens: 100, completionTokens: 0, cachedTokens: 100 }, { inputPerMtokUsd: 1, outputPerMtokUsd: 2 })!
    expect(cost).toBeCloseTo(100 / 1_000_000, 12)
  })
})

describe('defaultModel', () => {
  it('picks the first featured model, then the mock’s flagship, then the first', () => {
    const real = joinModels(live('alpha-model', 'openai/gpt-oss-20b', 'parasail-llama-33-70b-fp8'), table)
    expect(defaultModel(real)).toBe('parasail-llama-33-70b-fp8')
    expect(defaultModel([{ id: 'x', featured: false, pricing: null }, { id: 'parasail-llama-3.1-70b-instruct', featured: false, pricing: null }])).toBe(
      'parasail-llama-3.1-70b-instruct',
    )
    expect(defaultModel([{ id: 'only', featured: false, pricing: null }])).toBe('only')
  })
})
