import { describe, expect, it } from 'vitest'
import { parseRetryAfter, translateUpstreamStatus } from '../../src/server/upstream/translate-error'

const ctx = { requestId: 'req_1', runId: 'run_1', op: 'chat' as const }
const noHeaders = new Headers()

describe('translateUpstreamStatus', () => {
  it('a chat 404 means the model is gone', () => {
    const failure = translateUpstreamStatus(404, noHeaders, "Model 'x' was not found.", ctx)
    expect(failure.httpStatus).toBe(404)
    expect(failure.error).toMatchObject({ type: 'model_not_found', source: 'inference', runId: 'run_1' })
  })

  it('a 400 that talks about context becomes context_too_long', () => {
    const failure = translateUpstreamStatus(400, noHeaders, "This model's maximum context length is 32768 tokens.", ctx)
    expect(failure.error.type).toBe('context_too_long')
  })

  it('any other 400 keeps the upstream wording, which describes the user’s own request', () => {
    const failure = translateUpstreamStatus(400, noHeaders, 'stop sequences must be under 32 characters', ctx)
    expect(failure.error).toMatchObject({ type: 'invalid_request', message: 'stop sequences must be under 32 characters' })
  })

  it('an unusual 5xx is reported to the browser as 502', () => {
    expect(translateUpstreamStatus(520, noHeaders, undefined, ctx).httpStatus).toBe(502)
  })
})

describe('parseRetryAfter', () => {
  const now = Date.parse('2026-10-24T12:00:00Z')

  it('reads seconds', () => {
    expect(parseRetryAfter('3', now)).toBe(3000)
  })

  it('reads an HTTP date', () => {
    expect(parseRetryAfter('Sat, 24 Oct 2026 12:00:05 GMT', now)).toBe(5000)
  })

  it('never goes negative, and ignores junk', () => {
    expect(parseRetryAfter('Sat, 24 Oct 2026 11:00:00 GMT', now)).toBe(0)
    expect(parseRetryAfter('soon', now)).toBeUndefined()
    expect(parseRetryAfter(null, now)).toBeUndefined()
  })
})
