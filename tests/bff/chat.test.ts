import { describe, expect, it } from 'vitest'
import type { ApiErrorBody } from '../../src/shared/api-error'
import type { ChatRequest } from '../../src/shared/chat'
import { readSseData } from '../../src/shared/sse'
import type { StreamEvent } from '../../src/shared/stream-events'
import { createApp } from '../../src/server/app'
import { controlledStream, fakeUpstream, MOCK_MODELS, mockChatStream, simulatedError, sseBody, testConfig } from '../helpers'

const MODEL = 'parasail-llama-3.1-8b-instruct'

const request: ChatRequest = {
  settings: { model: MODEL, system: 'You are a concise senior engineer.', temperature: 0.3, topP: 0.9, maxTokens: 256, stop: ['###'], seed: 42 },
  messages: [{ role: 'user', content: 'Explain prompt caching in 3 bullets.' }],
}

type ChatHandler = (url: URL, init?: RequestInit) => Response | Promise<Response>

/** A fake inference API: the real model list, plus whatever the test wants from chat. */
function setup(chat: ChatHandler, config = testConfig()) {
  const upstream = fakeUpstream((url, init) => (url.pathname === '/v1/models' ? Response.json(MOCK_MODELS) : chat(url, init)))
  const app = createApp({ config, fetch: upstream.fetch })
  const chatCalls = () => upstream.calls.filter((c) => c.url.pathname === '/v1/chat/completions')
  return { app, chatCalls }
}

function post(app: ReturnType<typeof createApp>, body: unknown, init: RequestInit & { query?: string } = {}) {
  return app.request(
    new Request(`http://playground.test/api/chat${init.query ?? ''}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Run-Id': 'run_test', 'X-Request-Id': 'req_test', 'X-Attempt': '1' },
      body: typeof body === 'string' ? body : JSON.stringify(body),
      signal: init.signal,
    }),
  )
}

async function readEvents(res: Response): Promise<StreamEvent[]> {
  const out: StreamEvent[] = []
  for await (const data of readSseData(res.body!)) out.push(JSON.parse(data) as StreamEvent)
  return out
}

const streamOk = () => new Response(sseBody(mockChatStream(['Prompt ', 'caching.'], { prompt: 40, completion: 2 })), { headers: { 'Content-Type': 'text/event-stream' } })

describe('POST /api/chat', () => {
  it('streams tokens then done, with headers that stop anything from buffering', async () => {
    const { app } = setup(streamOk)
    const res = await post(app, request)

    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toMatch(/^text\/event-stream/)
    expect(res.headers.get('cache-control')).toContain('no-cache')
    expect(res.headers.get('x-accel-buffering')).toBe('no')
    expect(res.headers.get('content-encoding')).toBeNull()
    expect(res.headers.get('x-request-id')).toBe('req_test')

    expect(await readEvents(res)).toEqual([
      { type: 'token', text: 'Prompt ' },
      { type: 'token', text: 'caching.' },
      { type: 'done', finishReason: 'stop', usage: { promptTokens: 40, completionTokens: 2 }, costUsd: (40 * 0.05 + 2 * 0.1) / 1_000_000 },
    ])
  })

  it('forwards every setting upstream exactly as sent (the mock ignores them, so this is the proof)', async () => {
    const { app, chatCalls } = setup(streamOk)
    await readEvents(await post(app, request))

    const call = chatCalls()[0]!
    expect(JSON.parse(String(call.init?.body))).toEqual({
      model: MODEL,
      messages: [
        { role: 'system', content: 'You are a concise senior engineer.' },
        { role: 'user', content: 'Explain prompt caching in 3 bullets.' },
      ],
      temperature: 0.3,
      top_p: 0.9,
      max_tokens: 256,
      stop: ['###'],
      seed: 42,
      stream: true,
      stream_options: { include_usage: true },
    })
    expect(new Headers(call.init?.headers).get('x-request-id')).toBe('req_test')
  })

  it('rejects a bad setting with the field name, before calling upstream', async () => {
    const { app, chatCalls } = setup(streamOk)
    const res = await post(app, { ...request, settings: { ...request.settings, temperature: 3.5 } })
    const { error } = (await res.json()) as ApiErrorBody

    expect(res.status).toBe(400)
    expect(error).toMatchObject({
      type: 'invalid_request',
      source: 'playground',
      runId: 'run_test',
      message: 'Temperature must be between 0 and 2.',
      details: { field: 'settings.temperature' },
    })
    expect(chatCalls()).toHaveLength(0)
  })

  it('rejects a conversation that does not end with the user', async () => {
    const { app } = setup(streamOk)
    const res = await post(app, { ...request, messages: [...request.messages, { role: 'assistant', content: 'x' }] })
    expect(res.status).toBe(400)
  })

  it('rejects a model that is not in the list', async () => {
    const { app } = setup(streamOk)
    const res = await post(app, { ...request, settings: { ...request.settings, model: 'parasail-whisper-large-v3' } })
    expect(((await res.json()) as ApiErrorBody).error).toMatchObject({ type: 'invalid_request', details: { field: 'settings.model' } })
  })

  it('rejects a body over 512 KB', async () => {
    const { app } = setup(streamOk)
    const res = await post(app, { ...request, messages: [{ role: 'user', content: 'x'.repeat(600_000) }] })
    expect(res.status).toBe(413)
  })

  it('an upstream failure before the stream starts comes back as our error, with the run ID', async () => {
    const { app } = setup(() => simulatedError(503))
    const res = await post(app, request)
    expect(res.status).toBe(503)
    expect(((await res.json()) as ApiErrorBody).error).toMatchObject({
      type: 'inference_unavailable',
      source: 'inference',
      retryable: true,
      requestId: 'req_test',
      runId: 'run_test',
    })
  })

  it('passes ?_simulate to the mock', async () => {
    const { app, chatCalls } = setup((url) => simulatedError(Number(url.searchParams.get('_simulate'))))
    const res = await post(app, request, { query: '?_simulate=429' })
    expect(res.status).toBe(429)
    expect(chatCalls()[0]!.url.searchParams.get('_simulate')).toBe('429')
  })

  it('reports a cut-off answer as finishReason length (the mock never sends it)', async () => {
    const { app } = setup(() => new Response(sseBody(mockChatStream(['a'], { prompt: 1, completion: 256 }, 'length'))))
    const events = await readEvents(await post(app, request))
    expect(events.at(-1)).toMatchObject({ type: 'done', finishReason: 'length' })
  })

  it('a connection that breaks mid-stream ends in stream_interrupted', async () => {
    let upstream!: ReturnType<typeof controlledStream>
    const { app } = setup((_url, init) => {
      upstream = controlledStream(init?.signal)
      return new Response(upstream.body)
    })
    const res = await post(app, request)
    upstream.send(mockChatStream(['partial'], { prompt: 1, completion: 1 })[1]!)
    upstream.fail(new TypeError('terminated'))

    const events = await readEvents(res)
    expect(events.map((e) => e.type)).toEqual(['token', 'error'])
    expect(events[1]).toMatchObject({ error: { type: 'stream_interrupted', details: { reason: 'connection_lost' } } })
  })
})

describe('cancel reaches the upstream', () => {
  async function startStreaming() {
    let upstreamSignal: AbortSignal | null | undefined
    let upstream!: ReturnType<typeof controlledStream>
    const setupResult = setup((_url, init) => {
      upstreamSignal = init?.signal
      upstream = controlledStream(init?.signal)
      return new Response(upstream.body)
    })
    return { ...setupResult, signal: () => upstreamSignal, upstream: () => upstream }
  }

  it('when the browser closes the response stream (Stop, closed tab)', async () => {
    const t = await startStreaming()
    const res = await post(t.app, request)
    t.upstream().send(mockChatStream(['first'], { prompt: 1, completion: 1 })[1]!)

    const reader = res.body!.getReader()
    await reader.read() // the first token arrived
    expect(t.signal()?.aborted).toBe(false)

    await reader.cancel()
    expect(t.signal()?.aborted).toBe(true)
  })

  it('when the browser aborts the request', async () => {
    const t = await startStreaming()
    const browser = new AbortController()
    await post(t.app, request, { signal: browser.signal })

    browser.abort()
    expect(t.signal()?.aborted).toBe(true)
  })
})
