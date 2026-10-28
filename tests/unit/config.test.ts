import { describe, expect, it } from 'vitest'
import { loadConfig } from '../../src/server/config'

describe('loadConfig', () => {
  it('defaults to the local mock with the mock key, faults on and no password', () => {
    expect(loadConfig({})).toMatchObject({
      port: 3000,
      parasailBaseUrl: 'http://localhost:3001',
      parasailApiKey: 'psk-mock-mockkey',
      upstreamKind: 'mock',
      faultsEnabled: true,
      version: 'dev',
      playgroundPassword: undefined,
    })
  })

  it('recognises the real API, and turns faults off by default there', () => {
    const config = loadConfig({
      PARASAIL_BASE_URL: 'https://api.parasail.io/api/v1/openai/',
      PARASAIL_API_KEY: 'psk-abc-def',
      PLAYGROUND_PASSWORD: 'correct-horse-battery-staple',
    })
    expect(config).toMatchObject({
      parasailBaseUrl: 'https://api.parasail.io/api/v1/openai',
      upstreamKind: 'parasail',
      faultsEnabled: false,
    })
  })

  it('refuses the real API with the mock key', () => {
    expect(() => loadConfig({ PARASAIL_BASE_URL: 'https://api.parasail.io/api/v1/openai' })).toThrow(/PARASAIL_API_KEY/)
  })

  it('refuses the real API without a password, so the key is never open to anyone with the URL', () => {
    expect(() => loadConfig({ PARASAIL_BASE_URL: 'https://api.parasail.io/api/v1/openai', PARASAIL_API_KEY: 'psk-abc-def' })).toThrow(
      /PLAYGROUND_PASSWORD/,
    )
    // Compose passes an unset variable through as ''.
    expect(() =>
      loadConfig({ PARASAIL_BASE_URL: 'https://api.parasail.io/api/v1/openai', PARASAIL_API_KEY: 'psk-abc-def', PLAYGROUND_PASSWORD: '' }),
    ).toThrow(/PLAYGROUND_PASSWORD/)
  })

  it('gates the mock too when a password is set', () => {
    expect(loadConfig({ PLAYGROUND_PASSWORD: 'correct-horse-battery-staple' }).playgroundPassword).toBe('correct-horse-battery-staple')
  })

  it('refuses a base URL that is not a URL', () => {
    expect(() => loadConfig({ PARASAIL_BASE_URL: 'not a url' })).toThrow(/not a valid URL/)
  })

  it('lets PLAYGROUND_FAULTS override the default', () => {
    expect(loadConfig({ PLAYGROUND_FAULTS: 'false' }).faultsEnabled).toBe(false)
  })
})
