import { describe, expect, it } from 'vitest'
import { DEFAULT_SETTINGS } from '../../src/shared/chat'
import { panelDifferences } from '../../src/client/chat/differences'

const base = { ...DEFAULT_SETTINGS, model: 'm' }

describe('panelDifferences (each panel header shows its own side)', () => {
  it("gives one panel's values for the fields asked, in that order", () => {
    const s = { ...base, temperature: 1.1, system: 'You are a senior engineer.\nBe terse.' }
    expect(panelDifferences(['system', 'temperature'], s)).toEqual([
      { name: 'system prompt', value: '“You are a senior engineer.”', title: 'You are a senior engineer.\nBe terse.' },
      { name: 'temperature', value: '1.1' },
    ])
  })

  it('says none or random for empty values, and lists stop sequences', () => {
    expect(panelDifferences(['system', 'stop', 'seed'], base)).toEqual([
      { name: 'system prompt', value: 'none' },
      { name: 'stop', value: 'none' },
      { name: 'seed', value: 'random' },
    ])
    expect(panelDifferences(['stop', 'seed'], { ...base, stop: ['###', 'END'], seed: 7 })).toEqual([
      { name: 'stop', value: '"###", "END"' },
      { name: 'seed', value: '7' },
    ])
  })
})
