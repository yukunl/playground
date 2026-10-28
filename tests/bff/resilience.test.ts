import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ApiErrorBody } from '../../src/shared/api-error'
import type { ChatRequest } from '../../src/shared/chat'
import type { StreamEvent } from '../../src/shared/stream-events'
import { createApp } from '../../src/server/app'
import { controlledStream, fakeUpstream, MOCK_MODELS, mockChatStream, testConfig } from '../helpers'

// Short timers so the tests run in milliseconds.
const timings = { firstTokenMs: 60, stallMs: 60, heartbeatMs: 20 }
const MODEL = 'parasail-llama-3.1-8b-instruct'
const request: ChatRequest = {
  settings: { model: MODEL, system: '', temperature: 0.7, topP: 1, maxTokens: 64, stop: [] },
  messages: [{ role: 'user', content: 'hi' }],
}
const tokenChunk = (text: string) => mockChatStream([text], { prompt: 1, completion: 1 })[1]!

function setup(chat: (url: URL, init?: RequestInit) => Response | Promise<Response>, config = testConfig()) {
  const upstream = fakeUpstream((url, init) => (url.pathname === '/v1/models' ? Response.json(MOCK_MODELS) : chat(url, init)))
  return createApp({ config, fetch: upstream.fetch, timings })
}

function post(app: ReturnType<typeof createApp>, headers: Record<string, string> = {}) {
  return app.request('/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Run-Id': 'run_r', 'X-Request-Id': 'req_r', ...headers },
    body: JSON.stringify(request),
  })
}

/** Reads the raw stream: events plus the `: ping` heartbeats. */
async function readRaw(res: Response) {
  const text = await res.text()
  const events = text
    .split('\n\n')
    .filter((block) => block.startsWith('data:'))
    .map((block) => JSON.parse(block.slice(5)) as StreamEvent)
  return { events, pings: text.split('\n\n').filter((b) => b === ': ping').length }
}

afterEach(() => vi.restoreAllMocks())

describe('timeouts', () => {
  it('no response at all within the first-token timeout → 504 inference_unavailable, retryable', async () => {
    const app = setup((_url, init) => new Promise((_, reject) => init?.signal?.addEventListener('abort', () => reject(init.signal!.reason))))
    const res = await post(app)
    expect(res.status).toBe(504)
    expect(((await res.json()) as ApiErrorBody).error).toMatchObject({ type: 'inference_unavailable', retryable: true, details: { reason: 'timeout' } })
  })

  it('headers but no first token in time → an error event the browser can retry', async () => {
    const app = setup((_url, init) => new Response(controlledStream(init?.signal).body))
    const { events } = await readRaw(await post(app))
    expect(events).toMatchObject([{ type: 'error', error: { type: 'inference_unavailable', retryable: true, details: { reason: 'timeout' } } }])
  })

  it('tokens, then silence → stream_interrupted (stall), with the text so far already sent', async () => {
    const app = setup((_url, init) => {
      const s = controlledStream(init?.signal)
      s.send(tokenChunk('Hello'))
      return new Response(s.body)
    })
    const { events } = await readRaw(await post(app))
    expect(events.map((e) => e.type)).toEqual(['token', 'error'])
    expect(events[1]).toMatchObject({ error: { type: 'stream_interrupted', details: { reason: 'stall', afterTokens: 1 } } })
  })

  it('sends `: ping` heartbeats while a slow stream is open', async () => {
    const app = setup((_url, init) => {
      const s = controlledStream(init?.signal)
      // Tokens keep the stall timer happy; the heartbeat runs alongside.
      let i = 0
      const timer = setInterval(() => {
        if (++i > 5) {
          clearInterval(timer)
          for (const line of mockChatStream([], { prompt: 1, completion: 5 }).slice(1)) s.send(line)
          s.close()
        } else s.send(tokenChunk(`t${i} `))
      }, 15)
      return new Response(s.body)
    })
    const { events, pings } = await readRaw(await post(app))
    expect(events.at(-1)?.type).toBe('done')
    expect(pings).toBeGreaterThan(0)
  })
})

describe('fault switches (X-Fault)', () => {
  const streaming = () =>
    setup((_url, init) => {
      const s = controlledStream(init?.signal)
      for (let i = 0; i < 10; i++) s.send(tokenChunk(`w${i} `))
      return new Response(s.body)
    })

  it('drop_after:N closes the stream after N tokens, as stream_interrupted', async () => {
    const { events } = await readRaw(await post(streaming(), { 'X-Fault': 'drop_after:3' }))
    expect(events.map((e) => e.type)).toEqual(['token', 'token', 'token', 'error'])
    expect(events[3]).toMatchObject({ error: { type: 'stream_interrupted', details: { reason: 'closed_early', fault: 'drop_after:3' } } })
  })

  it('stall_after:N stops forwarding, and the stall timeout ends it', async () => {
    const { events } = await readRaw(await post(streaming(), { 'X-Fault': 'stall_after:2' }))
    expect(events.map((e) => e.type)).toEqual(['token', 'token', 'error'])
    expect(events[2]).toMatchObject({ error: { details: { reason: 'stall' } } })
  })

  it('are ignored when PLAYGROUND_FAULTS is off', async () => {
    const app = setup(
      () => new Response(new ReadableStream({ start: (c) => (mockChatStream(['a', 'b', 'c', 'd'], { prompt: 1, completion: 4 }).forEach((l) => c.enqueue(new TextEncoder().encode(`data: ${l}\n\n`))), c.close()) })),
      testConfig({ faultsEnabled: false }),
    )
    const { events } = await readRaw(await post(app, { 'X-Fault': 'drop_after:1' }))
    expect(events.at(-1)?.type).toBe('done')
  })

  it('an attempt that fails before streaming still logs exactly one line, with its status and error', async () => {
    const lines: string[] = []
    vi.spyOn(console, 'log').mockImplementation((line: string) => void lines.push(line))
    const app = setup(() => Response.json({ error: { message: 'busy' } }, { status: 503 }))
    await post(app, { 'X-Attempt': '2' })
    const attempts = lines.filter((l) => l.includes('chat_attempt')).map((l) => JSON.parse(l))
    expect(attempts).toHaveLength(1)
    expect(attempts[0]).toMatchObject({ attempt: 2, outcome: 'error', status: 503, error: { type: 'inference_unavailable', source: 'inference' }, model: MODEL })
  })

  it('every attempt’s log line records the fault and the upstream request ID, never the prompt', async () => {
    const lines: string[] = []
    vi.spyOn(console, 'log').mockImplementation((line: string) => void lines.push(line))
    const app = setup((_url, init) => {
      const s = controlledStream(init?.signal)
      for (let i = 0; i < 5; i++) s.send(tokenChunk(`w${i} `))
      return new Response(s.body, { headers: { 'x-parasail-request-id': 'pslr_123' } })
    })
    await readRaw(await post(app, { 'X-Fault': 'drop_after:2' }))
    const log = JSON.parse(lines.find((l) => l.includes('chat_attempt'))!)
    expect(log).toMatchObject({ outcome: 'interrupted', fault: 'drop_after:2', upstreamRequestId: 'pslr_123', tokens: 2 })
    expect(lines.join('\n')).not.toContain('"hi"')
  })
})

describe('privacy', () => {
  it('an upstream error that echoes the prompt never puts it in the logs', async () => {
    const lines: string[] = []
    vi.spyOn(console, 'log').mockImplementation((line: string) => void lines.push(line))
    vi.spyOn(console, 'error').mockImplementation((line: string) => void lines.push(line))
    const marker = 'MARKER-7f3k9q-private-prompt'
    const app = setup(() => Response.json({ error: { message: `Invalid input: "${marker}" is not allowed` } }, { status: 400 }))
    await app.request('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...request, messages: [{ role: 'user', content: marker }] }),
    })
    expect(lines.some((l) => l.includes('chat_attempt'))).toBe(true)
    expect(lines.join('\n')).not.toContain(marker)
  })
})
