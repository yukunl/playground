import { describe, expect, it } from 'vitest'
import type { ApiErrorBody } from '../../src/shared/api-error'
import type { Health } from '../../src/shared/models'
import { createApp } from '../../src/server/app'
import { fakeUpstream, MOCK_MODELS, simulatedError, testConfig } from '../helpers'

const flush = () => new Promise((resolve) => setTimeout(resolve, 0))

describe('GET /api/health', () => {
  it('reports version and upstream kind, and warms the model list', async () => {
    const upstream = fakeUpstream(() => Response.json(MOCK_MODELS))
    const app = createApp({ config: testConfig(), fetch: upstream.fetch })

    const first = (await (await app.request('/api/health')).json()) as Health
    expect(first).toEqual({ ok: true, version: 'test', upstream: 'unknown', upstreamKind: 'mock', faultsEnabled: true })

    await flush()
    const second = (await (await app.request('/api/health')).json()) as Health
    expect(second.upstream).toBe('ok')
    expect(upstream.calls).toHaveLength(1)
  })

  it('still answers 200 when the upstream is down', async () => {
    const app = createApp({ config: testConfig(), fetch: fakeUpstream(() => simulatedError(503)).fetch })

    await app.request('/api/health')
    await flush()
    const res = await app.request('/api/health')

    expect(res.status).toBe(200)
    expect(((await res.json()) as Health).upstream).toBe('unreachable')
  })
})

describe('request IDs', () => {
  const app = createApp({ config: testConfig(), fetch: fakeUpstream(() => Response.json(MOCK_MODELS)).fetch })

  it('echoes a sane incoming ID', async () => {
    const res = await app.request('/api/health', { headers: { 'X-Request-Id': 'req_from_browser' } })
    expect(res.headers.get('x-request-id')).toBe('req_from_browser')
  })

  it('replaces an unsafe or oversized one', async () => {
    for (const bad of ['bad id; drop table', '<script>', 'x'.repeat(129)]) {
      const res = await app.request('/api/health', { headers: { 'X-Request-Id': bad } })
      expect(res.headers.get('x-request-id')).toMatch(/^req_[a-f0-9]{20}$/)
    }
  })

  it('makes one up when there is none', async () => {
    const res = await app.request('/api/health')
    expect(res.headers.get('x-request-id')).toMatch(/^req_[a-f0-9]{20}$/)
  })
})

describe('unknown /api paths', () => {
  it('answer 404 in the error shape, not the page', async () => {
    const app = createApp({ config: testConfig(), fetch: fakeUpstream(() => Response.json(MOCK_MODELS)).fetch })
    const res = await app.request('/api/nope', { method: 'POST' })
    const body = (await res.json()) as ApiErrorBody

    expect(res.status).toBe(404)
    expect(body.error).toMatchObject({ type: 'invalid_request', source: 'playground', retryable: false })
    expect(body.error.requestId).toBe(res.headers.get('x-request-id'))
  })
})
