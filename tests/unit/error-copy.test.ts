import { describe, expect, it } from 'vitest'
import type { ApiError } from '../../src/shared/api-error'
import { describeError } from '../../src/client/errors/copy'

const err = (patch: Partial<ApiError>): ApiError => ({ type: 'internal_error', source: 'playground', retryable: false, message: 'x', requestId: 'r', ...patch })
const ctx = { model: 'Llama 3.3 70B' }

describe('describeError', () => {
  it('while retrying: a plain headline, the real status, and the countdown', () => {
    const c = describeError(err({ type: 'inference_unavailable', source: 'inference', status: 503, retryable: true }), { ...ctx, retrying: { seconds: 2, retry: 2 } })
    expect(c.headline).toBe('Model not responding')
    expect(c.body).toBe('Llama 3.3 70B didn’t respond (503 Service Unavailable). Retrying in 2s (retry 2 of 3)…')
    expect(c.bucket).toBe('itself')
  })

  it('after giving up: says how hard it tried and whose problem it is', () => {
    const c = describeError(err({ type: 'inference_unavailable', source: 'inference', status: 503, retryable: true, details: { gaveUpAfterRetries: 3, waitedMs: 5600 } }), ctx)
    expect(c.headline).toBe('Model unavailable')
    expect(c.body).toBe('Llama 3.3 70B was unavailable for 3 retries over about 6 seconds. The problem is on the model server, not in your request.')
    expect(c.actions).toEqual(['retry', 'switchModel', 'copyDebugInfo'])
  })

  it('a rejected key is the playground’s problem, never the user’s', () => {
    const c = describeError(err({ type: 'service_misconfigured', status: 401 }), ctx)
    expect(c.bucket).toBe('us')
    expect(c.headline).toBe('Playground setup problem')
    expect(c.body).toContain('That’s our problem')
    expect(c.body).not.toMatch(/your (api )?key/i)
  })

  it('an interrupted stream keeps the text and offers a manual retry', () => {
    const c = describeError(err({ type: 'stream_interrupted', source: 'inference', retryable: true, details: { reason: 'closed_early', fault: 'drop_after:40' } }), { ...ctx, tokens: 120 })
    expect(c.headline).toBe('Response interrupted')
    expect(c.body).toBe('Llama 3.3 70B’s response stopped partway, after about 120 tokens. The model server closed the connection (a test fault). What arrived is kept above.')
    expect(c.retryLabel).toBe('Retry from the start')
  })

  it('a bad setting names the fix', () => {
    const c = describeError(err({ type: 'invalid_request', message: 'Temperature must be between 0 and 2.', details: { field: 'settings.temperature' } }), ctx)
    expect(c).toMatchObject({ bucket: 'you', headline: 'Invalid request', actions: ['resetSetting', 'retry'] })
  })

  it('tells being offline apart from not reaching the server', () => {
    expect(describeError(err({ type: 'network_error', source: 'network', details: { reason: 'offline' } }), ctx).headline).toBe('You’re offline')
    expect(describeError(err({ type: 'network_error', source: 'network' }), ctx).headline).toBe('Can’t reach the playground')
  })

  it('every error type has a headline and a plain body', () => {
    const types: ApiError['type'][] = ['invalid_request', 'context_too_long', 'model_not_found', 'rate_limited', 'inference_unavailable', 'network_error', 'stream_interrupted', 'service_misconfigured', 'unauthorized', 'internal_error']
    for (const type of types) {
      // invalid_request shows the server's own wording, so give it a realistic one.
      const c = describeError(err({ type, message: 'Max tokens must be between 1 and 4096.' }), ctx)
      expect(c.headline.length).toBeGreaterThan(3)
      expect(c.body.length).toBeGreaterThan(10)
    }
  })
})
