import { describe, expect, it } from 'vitest'
import { DEFAULT_SETTINGS, SettingsSchema, type Settings } from '../../src/shared/chat'
import { anyChanged, describeChanges, differingFields, isChanged, outputTokenLimit, differingTunables } from '../../src/client/settings/settings-logic'

const base: Settings = { ...DEFAULT_SETTINGS, model: 'parasail-llama-3.1-70b-instruct' }

describe('describeChanges (the mid-chat divider)', () => {
  it('is empty when nothing changed', () => {
    expect(describeChanges(base, { ...base })).toEqual([])
  })

  it('names each change in words, with the friendly model name', () => {
    const next: Settings = { ...base, model: 'parasail-llama-3.1-8b-instruct', temperature: 0.3, system: 'Be brief.', stop: ['###'], seed: 7 }
    expect(describeChanges(base, next)).toEqual([
      'switched to Llama 3.1 8B',
      'system prompt changed',
      'temperature 0.3',
      'stop "###"',
      'seed 7',
    ])
  })

  it('says when something was removed', () => {
    const from: Settings = { ...base, system: 'x', stop: ['a'], seed: 1 }
    expect(describeChanges(from, base)).toEqual(['system prompt removed', 'no stop sequences', 'random seed'])
  })
})

describe('isChanged / anyChanged (the dots and Reset)', () => {
  it('compares against the defaults, including the stop list', () => {
    expect(anyChanged(base)).toBe(false)
    expect(isChanged('temperature', { ...base, temperature: 1 })).toBe(true)
    expect(isChanged('stop', { ...base, stop: ['x'] })).toBe(true)
    expect(isChanged('seed', { ...base, seed: 3 })).toBe(true)
  })
})

describe('outputTokenLimit', () => {
  it('is 4096 unless the context window leaves less room', () => {
    expect(outputTokenLimit(131_072, 1_000)).toBe(4096)
    expect(outputTokenLimit(32_768, 30_000)).toBe(2768)
    expect(outputTokenLimit(undefined, 99_999)).toBe(4096)
    expect(outputTokenLimit(1_000, 5_000)).toBe(1)
  })
})

describe('SettingsSchema messages (shown in the browser and returned by the server)', () => {
  const messageFor = (patch: Partial<Settings>) => SettingsSchema.safeParse({ ...base, ...patch }).error?.issues[0]?.message

  it('are written for people', () => {
    expect(messageFor({ temperature: 3.5 })).toBe('Temperature must be between 0 and 2.')
    expect(messageFor({ temperature: Number.NaN })).toBe('Temperature must be a number.')
    expect(messageFor({ topP: 1.5 })).toBe('Top-p must be between 0 and 1.')
    expect(messageFor({ maxTokens: 10_000 })).toBe('Max tokens must be between 1 and 4096.')
    expect(messageFor({ maxTokens: 1.5 })).toBe('Max tokens must be a whole number.')
    expect(messageFor({ stop: ['a', 'b', 'c', 'd', 'e'] })).toBe('At most 4 stop sequences.')
    expect(messageFor({ model: '' })).toBe('Pick a model.')
  })
})

describe('differingFields (B\'s header in compare)', () => {
  it('lists what differs from A, in settings-panel order', () => {
    expect(differingFields(base, { ...base })).toEqual([])
    expect(differingFields(base, { ...base, temperature: 0.2, system: 'Be brief.', model: 'other' })).toEqual(['model', 'system prompt', 'temperature'])
    expect(differingFields(base, { ...base, stop: ['###'], seed: 7 })).toEqual(['stop sequences', 'seed'])
  })
})

describe('differingTunables (the comparing line and the headers)', () => {
  it('lists the settings that differ, in panel order, never the model', () => {
    expect(differingTunables(base, { ...base, model: 'other', stop: ['END'], temperature: 0.2 })).toEqual(['temperature', 'stop'])
    expect(differingTunables(base, { ...base, seed: 7, system: 'Be brief.' })).toEqual(['system', 'seed'])
    expect(differingTunables(base, { ...base, stop: [...base.stop] })).toEqual([])
  })
})
