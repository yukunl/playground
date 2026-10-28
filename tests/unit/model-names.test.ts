import { describe, expect, it } from 'vitest'
import { displayName, formatContext, formatPricing, matchesQuery, modelName } from '../../src/client/model-names'

describe('displayName', () => {
  it.each([
    ['parasail-llama-3.1-70b-instruct', 'Llama 3.1 70B'],
    ['parasail-llama-3.1-8b-instruct', 'Llama 3.1 8B'],
    ['parasail-mixtral-8x7b-instruct', 'Mixtral 8x7B'],
    ['parasail-qwen-2.5-coder-32b', 'Qwen 2.5 Coder 32B'],
    ['some-unknown-model', 'some unknown model'],
    ['meta-llama/Llama-3.3-70B-Instruct', 'Llama 3.3 70B Instruct'],
  ])('%s → %s', (id, name) => {
    expect(displayName(id)).toBe(name)
  })

  it('prefers the name from our model table', () => {
    expect(modelName({ id: 'parasail-llama-33-70b-fp8', name: 'Llama 3.3 70B', featured: true, pricing: null }, 'parasail-llama-33-70b-fp8')).toBe('Llama 3.3 70B')
    expect(modelName(undefined, 'parasail-llama-3.1-8b-instruct')).toBe('Llama 3.1 8B')
  })
})

describe('matchesQuery (the picker search)', () => {
  const model = { id: 'parasail-llama-3.1-8b-instruct', pricing: null, featured: false }

  it('matches every word against the ID or the friendly name', () => {
    expect(matchesQuery(model, '8b')).toBe(true)
    expect(matchesQuery(model, 'llama 8')).toBe(true)
    expect(matchesQuery(model, 'LLAMA')).toBe(true)
    expect(matchesQuery(model, '')).toBe(true)
    expect(matchesQuery(model, '70b')).toBe(false)
    expect(matchesQuery(model, 'llama coder')).toBe(false)
  })
})

describe('formatting', () => {
  it('shows context and prices compactly', () => {
    expect(formatContext(131_072)).toBe('131k')
    expect(formatContext(512)).toBe('512')
    expect(formatPricing({ id: 'x', featured: false, pricing: { inputPerMtokUsd: 0.4, outputPerMtokUsd: 0.8 } })).toBe('$0.40 / $0.80 per M')
    expect(formatPricing({ id: 'x', featured: false, pricing: null })).toBeNull()
  })
})
