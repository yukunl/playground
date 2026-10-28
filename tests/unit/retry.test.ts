import { describe, expect, it } from 'vitest'
import type { ApiError } from '../../src/shared/api-error'
import { MAX_RETRIES, nextRetryDelay } from '../../src/client/chat/retry'

const err = (patch: Partial<ApiError> = {}): ApiError => ({
  type: 'inference_unavailable',
  source: 'inference',
  retryable: true,
  message: 'x',
  requestId: 'req',
  ...patch,
})

describe('nextRetryDelay', () => {
  it('backs off about 1s, 2s, 4s, with jitter between half and all of each', () => {
    expect([0, 1, 2].map((n) => nextRetryDelay(err(), n, 0, () => 0))).toEqual([500, 1000, 2000])
    expect([0, 1, 2].map((n) => nextRetryDelay(err(), n, 0, () => 1))).toEqual([1000, 2000, 4000])
  })

  it('never retries errors that won’t fix themselves', () => {
    expect(nextRetryDelay(err({ type: 'service_misconfigured', source: 'playground', retryable: false }), 0, 0)).toBeNull()
    expect(nextRetryDelay(err({ type: 'invalid_request', retryable: false }), 0, 0)).toBeNull()
  })

  it('stops after the third retry', () => {
    expect(nextRetryDelay(err(), MAX_RETRIES, 0)).toBeNull()
  })

  it('honours Retry-After when it is longer, and never shortens it', () => {
    expect(nextRetryDelay(err({ retryAfterMs: 3000 }), 0, 0, () => 0)).toBe(3000)
    expect(nextRetryDelay(err({ retryAfterMs: 100 }), 0, 0, () => 0)).toBe(500)
  })

  it('caps automatic waiting at 10 s in total, so three Retry-After: 9 responses stop after the first wait', () => {
    const nine = err({ retryAfterMs: 9000 })
    expect(nextRetryDelay(nine, 0, 0)).toBe(9000)
    expect(nextRetryDelay(nine, 1, 9000)).toBeNull()
  })

  it('keeps the worst case without Retry-After (1 + 2 + 4 s) inside the budget', () => {
    let waited = 0
    for (let n = 0; n < MAX_RETRIES; n++) {
      const d = nextRetryDelay(err(), n, waited, () => 0.999999)
      expect(d).not.toBeNull()
      waited += d!
    }
    expect(waited).toBeLessThanOrEqual(7000)
  })
})
