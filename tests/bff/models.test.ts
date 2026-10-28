import { describe, expect, it } from 'vitest'
import type { ApiErrorBody } from '../../src/shared/api-error'
import type { ModelsResponse } from '../../src/shared/models'
import { createApp } from '../../src/server/app'
import { fakeUpstream, manualClock, MOCK_MODELS, simulatedError, testConfig } from '../helpers'

const ok = () => Response.json(MOCK_MODELS)

describe('GET /api/models', () => {
  it('returns only chat-capable models, in our shape', async () => {
    const upstream = fakeUpstream(ok)
    const app = createApp({ config: testConfig(), fetch: upstream.fetch })

    const res = await app.request('/api/models')
    const body = (await res.json()) as ModelsResponse

    expect(res.status).toBe(200)
    expect(body.stale).toBe(false)
    expect(body.data.map((m) => m.id)).toEqual(['parasail-llama-3.1-70b-instruct', 'parasail-llama-3.1-8b-instruct'])
    expect(body.data[0]).toEqual({
      id: 'parasail-llama-3.1-70b-instruct',
      featured: false,
      ownedBy: 'parasail',
      contextLength: 131072,
      pricing: { inputPerMtokUsd: 0.4, outputPerMtokUsd: 0.8 },
      priceSource: 'api',
    })
    expect(body.pricesAsOf).toBeUndefined()
  })

  it('keeps models when the API does not say what they can do', async () => {
    const upstream = fakeUpstream(() => Response.json({ data: [{ id: 'some-model' }] }))
    const app = createApp({ config: testConfig(), fetch: upstream.fetch })

    const body = (await (await app.request('/api/models')).json()) as ModelsResponse
    expect(body.data).toEqual([{ id: 'some-model', featured: false, pricing: null }])
  })

  it('features models from our table when the real API lists them, with the date of the table prices', async () => {
    const realApi = { object: 'list', data: ['zeta/new-model', 'meta-llama/Llama-3.3-70B-Instruct', 'parasail-llama-33-70b-fp8', 'parasail-bge-m3'].map((id) => ({ id, object: 'model', owned_by: 'owner' })) }
    const app = createApp({ config: testConfig(), fetch: fakeUpstream(() => Response.json(realApi)).fetch })

    const body = (await (await app.request('/api/models')).json()) as ModelsResponse
    expect(body.data.map((m) => [m.id, m.featured, m.priceSource ?? null])).toEqual([
      ['parasail-llama-33-70b-fp8', true, 'table'],
      ['zeta/new-model', false, null],
    ])
    expect(body.data[0]!.name).toBe('Llama 3.3 70B')
    expect(body.pricesAsOf).toBe('2026-10-24')
  })

  it('sends the key and the request ID upstream', async () => {
    const upstream = fakeUpstream(ok)
    const app = createApp({ config: testConfig(), fetch: upstream.fetch })

    await app.request('/api/models', { headers: { 'X-Request-Id': 'req_abc' } })

    const headers = new Headers(upstream.calls[0]!.init?.headers)
    expect(upstream.calls[0]!.url.toString()).toBe('http://mock.test/v1/models')
    expect(headers.get('authorization')).toBe('Bearer psk-mock-mockkey')
    expect(headers.get('x-request-id')).toBe('req_abc')
  })

  it('caches the list for 5 minutes', async () => {
    const clock = manualClock()
    const upstream = fakeUpstream(ok)
    const app = createApp({ config: testConfig(), fetch: upstream.fetch, now: clock.now })

    await app.request('/api/models')
    clock.advance(4 * 60_000)
    await app.request('/api/models')
    expect(upstream.calls).toHaveLength(1)

    clock.advance(2 * 60_000)
    await app.request('/api/models')
    expect(upstream.calls).toHaveLength(2)
  })

  it('shares one upstream call between concurrent requests', async () => {
    const upstream = fakeUpstream(ok)
    const app = createApp({ config: testConfig(), fetch: upstream.fetch })

    await Promise.all([app.request('/api/models'), app.request('/api/models'), app.request('/api/models')])
    expect(upstream.calls).toHaveLength(1)
  })

  it('serves the last good list, marked stale, when a refresh fails', async () => {
    const clock = manualClock()
    let healthy = true
    const upstream = fakeUpstream(() => (healthy ? ok() : simulatedError(503)))
    const app = createApp({ config: testConfig(), fetch: upstream.fetch, now: clock.now })

    await app.request('/api/models')
    healthy = false
    clock.advance(6 * 60_000)

    const res = await app.request('/api/models')
    const body = (await res.json()) as ModelsResponse
    expect(res.status).toBe(200)
    expect(body.stale).toBe(true)
    expect(body.data).toHaveLength(2)
  })
})

describe('GET /api/models when the upstream fails and nothing is cached', () => {
  async function failWith(response: () => Response | Promise<Response>) {
    const app = createApp({ config: testConfig(), fetch: fakeUpstream(response).fetch })
    const res = await app.request('/api/models', { headers: { 'X-Request-Id': 'req_fail' } })
    return { res, error: ((await res.json()) as ApiErrorBody).error }
  }

  it('503 → inference_unavailable, retryable, same status', async () => {
    const { res, error } = await failWith(() => simulatedError(503))
    expect(res.status).toBe(503)
    expect(error).toMatchObject({
      type: 'inference_unavailable',
      source: 'inference',
      retryable: true,
      status: 503,
      requestId: 'req_fail',
    })
  })

  it('401 → service_misconfigured, owned by the playground, not retryable', async () => {
    const { res, error } = await failWith(() => simulatedError(401))
    expect(res.status).toBe(502)
    expect(error).toMatchObject({ type: 'service_misconfigured', source: 'playground', retryable: false, status: 401 })
    expect(error.message).not.toMatch(/your/i)
  })

  it('429 → rate_limited with the Retry-After wait', async () => {
    const { res, error } = await failWith(() => simulatedError(429, { 'Retry-After': '2' }))
    expect(res.status).toBe(429)
    expect(error).toMatchObject({ type: 'rate_limited', source: 'inference', retryable: true, retryAfterMs: 2000 })
  })

  it('404 on the model list → wrong base URL, our problem', async () => {
    const { error } = await failWith(() => simulatedError(404))
    expect(error).toMatchObject({ type: 'service_misconfigured', source: 'playground' })
  })

  it('no response at all → inference_unavailable (unreachable)', async () => {
    const { res, error } = await failWith(() => {
      throw new TypeError('fetch failed')
    })
    expect(res.status).toBe(502)
    expect(error).toMatchObject({ type: 'inference_unavailable', retryable: true, details: { reason: 'unreachable' } })
  })

  it('an unreadable 200 → inference_unavailable (bad response), not retried', async () => {
    const { res, error } = await failWith(() => new Response('<html>oops</html>', { status: 200 }))
    expect(res.status).toBe(502)
    expect(error).toMatchObject({ type: 'inference_unavailable', retryable: false, details: { reason: 'bad_response' } })
  })
})

describe('?_simulate on /api/models', () => {
  it('passes through to the mock and skips the cache', async () => {
    const upstream = fakeUpstream((url) => (url.searchParams.has('_simulate') ? simulatedError(503) : ok()))
    const app = createApp({ config: testConfig(), fetch: upstream.fetch })

    await app.request('/api/models') // fills the cache
    const res = await app.request('/api/models?_simulate=503')

    expect(res.status).toBe(503)
    expect(upstream.calls[1]!.url.searchParams.get('_simulate')).toBe('503')
  })

  it('is ignored when faults are off', async () => {
    const upstream = fakeUpstream(ok)
    const app = createApp({ config: testConfig({ faultsEnabled: false }), fetch: upstream.fetch })

    const res = await app.request('/api/models?_simulate=503')

    expect(res.status).toBe(200)
    expect(upstream.calls[0]!.url.searchParams.has('_simulate')).toBe(false)
  })

  it('never reaches the real API: the BFF answers itself', async () => {
    const upstream = fakeUpstream(ok)
    const config = testConfig({ upstreamKind: 'parasail', parasailBaseUrl: 'https://api.parasail.io/api/v1/openai' })
    const app = createApp({ config, fetch: upstream.fetch })

    const res = await app.request('/api/models?_simulate=429')

    expect(res.status).toBe(429)
    expect(upstream.calls).toHaveLength(0)
  })

  it('treats a value that is not an error status as 500, like the mock', async () => {
    const upstream = fakeUpstream((url) => simulatedError(Number(url.searchParams.get('_simulate'))))
    const app = createApp({ config: testConfig(), fetch: upstream.fetch })

    const res = await app.request('/api/models?_simulate=abc')
    expect(res.status).toBe(500)
    expect(upstream.calls[0]!.url.searchParams.get('_simulate')).toBe('500')
  })
})
