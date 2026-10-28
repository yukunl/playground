// Ways to make a run fail on purpose. They only work when the
// server has PLAYGROUND_FAULTS on, and every faked failure is tagged in the logs.

export type FaultPlan = {
  /** `?_simulate=N` for a given attempt (1 = the first try). */
  simulateFor?: (attempt: number) => string | null
  /** A BFF fault switch, sent as `X-Fault`. */
  fault?: string | null
}

export type WeatherPreset = 'clear' | 'busy' | 'unavailable' | 'broken-key' | 'stream-drops'

export const WEATHER: Record<WeatherPreset, { label: string; shows: string; plan: FaultPlan }> = {
  clear: {
    label: 'Clear',
    shows: 'No faults',
    plan: {},
  },
  busy: {
    label: 'Busy, then recovers',
    shows: '429 on the first 2 attempts, then the answer streams',
    plan: { simulateFor: (attempt) => (attempt <= 2 ? '429' : null) },
  },
  unavailable: {
    label: 'Model unavailable',
    shows: '503 on every attempt: 3 retries, then the give-up card',
    plan: { simulateFor: () => '503' },
  },
  'broken-key': {
    label: 'Broken key',
    shows: '401: the playground’s key is broken, not yours',
    plan: { simulateFor: () => '401' },
  },
  'stream-drops': {
    label: 'Stream drops',
    shows: 'The stream drops after 40 tokens; the partial text stays',
    plan: { fault: 'drop_after:40' },
  },
}

/** `?_simulate=503` on the page URL applies to every attempt, as the brief describes. */
export function planFromUrl(search: string): FaultPlan {
  const simulate = new URLSearchParams(search).get('_simulate')
  return simulate ? { simulateFor: () => simulate } : {}
}
