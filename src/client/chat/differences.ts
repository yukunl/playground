import type { Settings } from '../../shared/chat'
import type { Tunable } from '../settings/settings-logic'

const NAMES: Record<Tunable, string> = {
  system: 'system prompt',
  temperature: 'temperature',
  maxTokens: 'max tokens',
  topP: 'top-p',
  stop: 'stop',
  seed: 'seed',
}

/** One setting as a panel header shows it. `title` is the whole value when `value` gets cut off. */
export type Difference = { name: string; value: string; title?: string }

/**
 * A panel's own values for the settings A and B differ in, for its header, so each side's
 * setup sits above its own answers: system prompt “Be concise.”, temperature 0.2.
 */
export function panelDifferences(fields: readonly Tunable[], s: Settings): Difference[] {
  return fields.map((field) => ({ name: NAMES[field], ...valueOf(field, s) }))
}

function valueOf(field: Tunable, s: Settings): Omit<Difference, 'name'> {
  switch (field) {
    case 'system': {
      const line = s.system.trim().split('\n')[0]!
      return line ? { value: `“${line}”`, title: s.system.trim().slice(0, 500) } : { value: 'none' }
    }
    case 'stop':
      return { value: s.stop.length === 0 ? 'none' : s.stop.map((x) => JSON.stringify(x)).join(', ') }
    case 'seed':
      return { value: s.seed === undefined ? 'random' : String(s.seed) }
    default:
      return { value: String(s[field]) }
  }
}
