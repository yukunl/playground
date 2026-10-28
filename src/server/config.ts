import type { UpstreamKind } from '../shared/models'

export type Config = {
  port: number
  /** No trailing slash. Paths like /v1/models are appended to it, for the mock and the real API alike. */
  parasailBaseUrl: string
  parasailApiKey: string
  upstreamKind: UpstreamKind
  /** `?_simulate`, fault switches and Weather control. */
  faultsEnabled: boolean
  version: string
  /** The preview gate on the page and every /api route but health (middleware/preview-gate.ts). Unset = no gate. */
  playgroundPassword: string | undefined
}

const MOCK_KEY = 'psk-mock-mockkey'

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parasailBaseUrl = (env.PARASAIL_BASE_URL || 'http://localhost:3001').replace(/\/+$/, '')

  let hostname: string
  try {
    hostname = new URL(parasailBaseUrl).hostname
  } catch {
    throw new Error(`PARASAIL_BASE_URL is not a valid URL: ${parasailBaseUrl}`)
  }
  const upstreamKind: UpstreamKind = hostname.endsWith('parasail.io') ? 'parasail' : 'mock'

  const parasailApiKey = env.PARASAIL_API_KEY || MOCK_KEY
  if (upstreamKind === 'parasail' && parasailApiKey === MOCK_KEY) {
    throw new Error('PARASAIL_BASE_URL points at the real API, so PARASAIL_API_KEY must be set too.')
  }

  // Compose passes an unset variable through as '', which means no gate.
  const playgroundPassword = env.PLAYGROUND_PASSWORD || undefined
  if (upstreamKind === 'parasail' && !playgroundPassword) {
    throw new Error('PARASAIL_BASE_URL points at the real API, so PLAYGROUND_PASSWORD must be set too, or anyone with the URL can spend the key.')
  }

  return {
    port: Number(env.PORT) || 3000,
    parasailBaseUrl,
    parasailApiKey,
    upstreamKind,
    // On against the mock, off against the real API, unless set explicitly.
    faultsEnabled: env.PLAYGROUND_FAULTS ? env.PLAYGROUND_FAULTS === 'true' : upstreamKind === 'mock',
    version: env.GIT_SHA || 'dev',
    playgroundPassword,
  }
}
