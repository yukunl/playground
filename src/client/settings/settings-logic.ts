import { DEFAULT_SETTINGS, MAX_OUTPUT_TOKENS, type Settings } from '../../shared/chat'
import { displayName } from '../model-names'

/**
 * What changed between two runs, in words, for the divider in the chat:
 * "switched to Llama 3.1 8B, temperature 0.3". Empty when nothing changed.
 */
export function describeChanges(prev: Settings, next: Settings, nameOf: (id: string) => string = displayName): string[] {
  const changes: string[] = []
  if (prev.model !== next.model) changes.push(`switched to ${nameOf(next.model)}`)
  if (prev.system !== next.system) changes.push(next.system ? 'system prompt changed' : 'system prompt removed')
  if (prev.temperature !== next.temperature) changes.push(`temperature ${next.temperature}`)
  if (prev.topP !== next.topP) changes.push(`top-p ${next.topP}`)
  if (prev.maxTokens !== next.maxTokens) changes.push(`max tokens ${next.maxTokens}`)
  if (prev.stop.join('\u0000') !== next.stop.join('\u0000')) {
    changes.push(next.stop.length > 0 ? `stop ${next.stop.map((s) => JSON.stringify(s)).join(', ')}` : 'no stop sequences')
  }
  if (prev.seed !== next.seed) changes.push(next.seed === undefined ? 'random seed' : `seed ${next.seed}`)
  return changes
}

/** Which settings differ between two columns, for B's header in compare: ["model", "temperature"]. */
export function differingFields(a: Settings, b: Settings): string[] {
  const fields: string[] = []
  if (a.model !== b.model) fields.push('model')
  if (a.system !== b.system) fields.push('system prompt')
  if (a.temperature !== b.temperature) fields.push('temperature')
  if (a.topP !== b.topP) fields.push('top-p')
  if (a.maxTokens !== b.maxTokens) fields.push('max tokens')
  if (a.stop.join('\u0000') !== b.stop.join('\u0000')) fields.push('stop sequences')
  if (a.seed !== b.seed) fields.push('seed')
  return fields
}

/** Every setting except the model, which is picked per side in the prompt box. */
export type Tunable = Exclude<keyof Settings, 'model'>
export const TUNABLES: readonly Tunable[] = ['system', 'temperature', 'maxTokens', 'topP', 'stop', 'seed']

/** The settings other than the model that differ between A and B, in panel order: for the comparing line and the headers. */
export function differingTunables(a: Settings, b: Settings): Tunable[] {
  return TUNABLES.filter((field) => (field === 'stop' ? a.stop.join('\u0000') !== b.stop.join('\u0000') : a[field] !== b[field]))
}

/** For the dot next to a setting's label. */
export function isChanged(field: Tunable, settings: Settings): boolean {
  if (field === 'stop') return settings.stop.join('\u0000') !== DEFAULT_SETTINGS.stop.join('\u0000')
  return settings[field] !== DEFAULT_SETTINGS[field]
}

export function anyChanged(settings: Settings): boolean {
  return (['system', 'temperature', 'topP', 'maxTokens', 'stop', 'seed'] as const).some((f) => isChanged(f, settings))
}

/** Rough count while typing; the API's own count arrives with each answer. */
export function estimatePromptTokens(text: string): number {
  return Math.ceil(text.length / 4)
}

/** The most output a model leaves room for, given what's already in the prompt. */
export function outputTokenLimit(contextLength: number | undefined, promptTokens: number): number {
  const room = contextLength ? contextLength - promptTokens : MAX_OUTPUT_TOKENS
  return Math.max(1, Math.min(MAX_OUTPUT_TOKENS, room))
}
