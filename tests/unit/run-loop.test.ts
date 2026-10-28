import { describe, expect, it } from 'vitest'
import { setImmediate as nextTurn } from 'node:timers/promises'
import type { ApiError } from '../../src/shared/api-error'
import type { StreamEvent } from '../../src/shared/stream-events'
import { chatReducer, initialChat, type ChatAction } from '../../src/client/chat/reducer'
import { startRun, type RunArgs, type RunDeps } from '../../src/client/chat/run-stream'
import { animationClock } from '../helpers/animation-clock'

const request: RunArgs['request'] = {
  settings: { model: 'm', system: '', temperature: 0.7, topP: 1, maxTokens: 64, stop: [] },
  messages: [{ role: 'user', content: 'hi' }],
}

const sse = (events: StreamEvent[]) => {
  const encoder = new TextEncoder()
  return new Response(
    new ReadableStream({
      start(c) {
        for (const e of events) c.enqueue(encoder.encode(`data: ${JSON.stringify(e)}\n\n`))
        c.close()
      },
    }),
    { headers: { 'Content-Type': 'text/event-stream' } },
  )
}
const failure = (status: number, error: Partial<ApiError>) =>
  Response.json({ error: { source: 'inference', message: 'x', requestId: 'r', retryable: true, ...error } }, { status })
const unavailable = () => failure(503, { type: 'inference_unavailable', status: 503 })
const done: StreamEvent = { type: 'done', finishReason: 'stop', usage: { promptTokens: 1, completionTokens: 2 }, costUsd: null }

type Attempt = (n: number, init: RequestInit, url: string) => Response | Promise<Response>

/** Runs the loop with fake browser pieces, and returns every action plus what was sent. */
async function run(attempt: Attempt, opts: { online?: () => boolean; args?: Partial<RunArgs>; cancelAfter?: (actions: ChatAction[]) => boolean } = {}) {
  const actions: ChatAction[] = []
  const sent: { url: string; headers: Record<string, string> }[] = []
  const sleeps: number[] = []
  let n = 0
  let ids = 0
  let clock = 1_000_000
  let frameId = 0
  const cancelledFrames = new Set<number>()
  let resolveEnd!: () => void
  const ended = new Promise<void>((r) => (resolveEnd = r))
  let handle: { cancel: () => void } | undefined

  const deps: RunDeps = {
    fetch: (async (url: string, init: RequestInit) => {
      sent.push({ url, headers: init.headers as Record<string, string> })
      return attempt(++n, init, url)
    }) as unknown as typeof fetch,
    now: () => clock,
    random: () => 0.5,
    sleep: async (ms, signal) => (sleeps.push(ms), !signal.aborted),
    isOnline: opts.online ?? (() => true),
    waitForOnline: async () => true,
    frame: (cb) => {
      const id = ++frameId
      queueMicrotask(() => {
        if (!cancelledFrames.has(id)) { clock += 16; cb() }
      })
      return id
    },
    cancelFrame: (id) => { cancelledFrames.add(id) },
    newRequestId: () => `req_retry${++ids}`,
  }
  handle = startRun(
    { request, runId: 'run_1', requestId: 'req_first', ...opts.args },
    (a) => {
      actions.push(a)
      if (opts.cancelAfter?.(actions)) handle?.cancel()
      if (['done', 'failed', 'interrupted', 'cancelled'].includes(a.type)) resolveEnd()
    },
    deps,
  )
  await ended
  return { actions, sent, sleeps, final: actions.at(-1)!, types: actions.map((a) => a.type) }
}

describe('the run loop', () => {
  it('recovers: 503, 503, then the answer streams', async () => {
    const r = await run((n) => (n <= 2 ? unavailable() : sse([{ type: 'token', text: 'Hi' }, done])))
    expect(r.types).toEqual(['attemptStarted', 'attemptFailed', 'retrying', 'attemptStarted', 'attemptFailed', 'retrying', 'attemptStarted', 'tokens', 'done'])
    expect(r.sleeps).toEqual([750, 1500]) // 1s and 2s backoff with jitter (random = 0.5)
    expect(r.sent.map((s) => [s.headers['X-Request-Id'], s.headers['X-Attempt']])).toEqual([
      ['req_first', '1'],
      ['req_retry1', '2'],
      ['req_retry2', '3'],
    ])
  })

  it('gives up after the third retry, and says how hard it tried', async () => {
    const r = await run(() => unavailable())
    expect(r.sent).toHaveLength(4)
    expect(r.final).toMatchObject({ type: 'failed', error: { type: 'inference_unavailable', details: { gaveUpAfterRetries: 3, waitedMs: 5250 } } })
  })

  it('never retries an error that won’t fix itself', async () => {
    const r = await run(() => failure(502, { type: 'service_misconfigured', source: 'playground', retryable: false, status: 401 }))
    expect(r.sent).toHaveLength(1)
    expect(r.final).toMatchObject({ type: 'failed', error: { type: 'service_misconfigured' } })
  })

  it('does not retry after text has reached the screen: the run is interrupted', async () => {
    const r = await run(() => sse([{ type: 'token', text: 'partial' }, { type: 'error', error: { type: 'stream_interrupted', source: 'inference', retryable: true, message: 'x', requestId: 'r' } }]))
    expect(r.sent).toHaveLength(1)
    expect(r.types.slice(-2)).toEqual(['attemptFailed', 'interrupted'])
  })

  it('does retry a stream that broke before its first token', async () => {
    const r = await run((n) =>
      n === 1 ? sse([{ type: 'error', error: { type: 'stream_interrupted', source: 'inference', retryable: true, message: 'x', requestId: 'r' } }]) : sse([done]),
    )
    expect(r.sent).toHaveLength(2)
    expect(r.final.type).toBe('done')
  })

  it('Cancel during the countdown stops everything', async () => {
    const r = await run(() => unavailable(), { cancelAfter: (a) => a.at(-1)?.type === 'retrying' })
    expect(r.final.type).toBe('cancelled')
    expect(r.sent).toHaveLength(1)
  })

  it('offline: waits for the connection, and that wait is not a retry', async () => {
    let online = false
    const r = await run(
      (n) => {
        if (n === 1) {
          throw new TypeError('Failed to fetch')
        }
        return sse([done])
      },
      { online: () => (online = !online ? false : true) },
    )
    expect(r.actions.find((a) => a.type === 'retrying')).toMatchObject({ until: null, retry: 1 })
    expect(r.sleeps).toEqual([])
    expect(r.final.type).toBe('done')
  })

  it('applies ?_simulate per attempt and sends the fault switch', async () => {
    const r = await run((n) => (n <= 2 ? failure(429, { type: 'rate_limited', status: 429 }) : sse([done])), {
      args: { simulateFor: (attempt) => (attempt <= 2 ? '429' : null), fault: 'drop_after:40' },
    })
    expect(r.sent.map((s) => s.url)).toEqual(['/api/chat?_simulate=429', '/api/chat?_simulate=429', '/api/chat'])
    expect(r.sent[0]!.headers['X-Fault']).toBe('drop_after:40')
  })
})

/** A burst from the network at 1100 ms; animation frames advance only on demand. */
async function pacedRun(events: StreamEvent[]) {
  const clock = animationClock()
  const actions: ChatAction[] = []
  let state = chatReducer(initialChat(), { type: 'send', columnId: 'col_a', text: 'hi', runId: 'run_1', requestId: 'req_first', at: clock.now() })
  let requests = 0
  const handle = startRun({ request, runId: 'run_1', requestId: 'req_first' }, (action) => {
    actions.push(action)
    state = chatReducer(state, action)
  }, {
    ...clock,
    fetch: async () => { requests++; clock.advance(100); return sse(events) },
    random: () => 0.5,
    sleep: async () => true,
    isOnline: () => true,
    waitForOnline: async () => true,
    newRequestId: () => 'req_retry',
  })
  await nextTurn()
  return { clock, actions, handle, answer: () => state.columns[0]!.messages[1]!, requests: () => requests }
}

describe('network and display lifecycle', () => {
  const text = 'One two three four five six seven eight nine ten.'

  it('keeps the run active until queued words drain, retaining network timings and counts', async () => {
    const r = await pacedRun([{ type: 'token', text }, done])
    expect(r.answer()).toMatchObject({ status: 'streaming', text: '' })
    r.clock.advance()
    expect(r.answer()).toMatchObject({ status: 'streaming', text: 'One ', firstTokenAt: 1100, receivedAt: 1100, receivedChars: text.length })
    expect(r.actions.some((action) => action.type === 'done')).toBe(false)
    for (let i = 0; i < 100 && r.clock.pendingFrames(); i++) r.clock.advance()
    await nextTurn()
    expect(r.answer()).toMatchObject({ status: 'done', text, firstTokenAt: 1100, finishedAt: 1100 })
    expect(r.clock.now()).toBeGreaterThan(1300)
    expect(r.clock.pendingFrames()).toBe(0)
  })

  it('Stop cancels display draining even after the network has finished', async () => {
    const r = await pacedRun([{ type: 'token', text }, done])
    r.clock.advance()
    r.handle.cancel()
    await nextTurn()
    r.clock.advance(1000)
    expect(r.answer()).toMatchObject({ status: 'cancelled', text: 'One ' })
    expect(r.actions.some((action) => action.type === 'done')).toBe(false)
    expect(r.clock.pendingFrames()).toBe(0)
    expect(r.requests()).toBe(1)
  })

  it('an interruption flushes received text before the error and does not retry queued tokens', async () => {
    const r = await pacedRun([
      { type: 'token', text },
      { type: 'error', error: { type: 'stream_interrupted', source: 'inference', retryable: true, message: 'x', requestId: 'r' } },
    ])
    expect(r.answer()).toMatchObject({ status: 'interrupted', text })
    expect(r.actions.map((action) => action.type)).toEqual(['attemptStarted', 'tokens', 'attemptFailed', 'interrupted'])
    expect(r.requests()).toBe(1)
    expect(r.clock.pendingFrames()).toBe(0)
  })
})
