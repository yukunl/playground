import type { ApiError, ApiErrorBody } from '../../shared/api-error'
import type { ChatRequest } from '../../shared/chat'
import { readSseData } from '../../shared/sse'
import type { StreamEvent } from '../../shared/stream-events'
import { newId } from '../ids'
import type { ChatAction } from './reducer'
import { createDisplayQueue } from './display-queue'
import { nextRetryDelay } from './retry'

export type RunArgs = {
  request: ChatRequest
  runId: string
  /** The first attempt's request ID; each retry gets a new one. */
  requestId: string
  /** `?_simulate=N` for a given attempt, from the page URL or Weather control. */
  simulateFor?: (attempt: number) => string | null
  /** A BFF fault switch (`X-Fault`), from Weather control. */
  fault?: string | null
}

/** Everything the run loop needs from the browser, passed in so tests can control it. */
export type RunDeps = {
  fetch: typeof fetch
  now: () => number
  random: () => number
  /** Resolves true after `ms`, or false as soon as `signal` aborts. */
  sleep: (ms: number, signal: AbortSignal) => Promise<boolean>
  isOnline: () => boolean
  /** Resolves true when the browser is back online, or false if `signal` aborts first. */
  waitForOnline: (signal: AbortSignal) => Promise<boolean>
  frame: (cb: () => void) => number
  cancelFrame: (id: number) => void
  /** Reduced motion and hidden tabs receive text without display pacing. */
  shouldAnimate?: () => boolean
  newRequestId: () => string
}

type Outcome =
  | { kind: 'done'; event: Extract<StreamEvent, { type: 'done' }> }
  | { kind: 'error'; error: ApiError; tokens: number }
  | { kind: 'cancelled' }

/**
 * One answer, with retries (design §22). The browser owns the retry loop: each
 * attempt is a normal request, so the BFF logs and rate-limits every one, and
 * the user sees a countdown they can cancel. Rules:
 * - only errors that fix themselves are retried, and only before the first token;
 * - up to 3 retries, about 1s / 2s / 4s with jitter, at most 10 s of waiting in total;
 * - offline: wait for the connection to come back (that wait isn't a retry).
 *
 * Network reads run at full speed. A separate display queue reveals words on
 * animation frames, retaining network arrival times for the performance stats.
 */
export function startRun(args: RunArgs, dispatch: (action: ChatAction) => void, deps: RunDeps = browserDeps()): { cancel: () => void } {
  const { runId } = args
  const stop = new AbortController()

  let firstTokenAt: number | undefined
  let receivedAt = deps.now()
  let receivedChars = 0
  const display = createDisplayQueue((text) => {
    dispatch({ type: 'tokens', runId, text, at: receivedAt, firstTokenAt, receivedChars })
  }, deps)
  const onToken = (text: string) => {
    receivedAt = deps.now()
    firstTokenAt ??= receivedAt
    receivedChars += text.length
    display.push(text)
  }

  void (async () => {
    let retries = 0
    let waited = 0

    for (let number = 1; ; number++) {
      const requestId = number === 1 ? args.requestId : deps.newRequestId()
      dispatch({ type: 'attemptStarted', runId, requestId, number, at: deps.now() })

      const outcome = await runAttempt({ ...args, requestId, attempt: number, simulate: args.simulateFor?.(number) ?? null }, onToken, stop.signal, deps)
      const finishedAt = deps.now()

      if (outcome.kind === 'done') {
        await display.finish()
        if (stop.signal.aborted) return dispatch({ type: 'cancelled', runId, at: deps.now() })
        const { type: _type, ...done } = outcome.event
        return dispatch({ type: 'done', runId, ...done, at: finishedAt })
      }
      if (outcome.kind === 'cancelled' || stop.signal.aborted) {
        display.cancel()
        return dispatch({ type: 'cancelled', runId, at: finishedAt })
      }

      display.flush()
      const { error } = outcome
      dispatch({ type: 'attemptFailed', runId, requestId, error, at: deps.now() })

      // Text is already on screen: retrying could duplicate or change it, so the user decides.
      if (outcome.tokens > 0) return dispatch({ type: 'interrupted', runId, error, at: deps.now() })

      // Offline: wait for the connection instead of burning retries.
      if (error.type === 'network_error' && !deps.isOnline()) {
        dispatch({ type: 'retrying', runId, error, retry: retries + 1, until: null })
        if (!(await deps.waitForOnline(stop.signal))) return dispatch({ type: 'cancelled', runId, at: deps.now() })
        continue
      }

      const delay = nextRetryDelay(error, retries, waited, deps.random)
      if (delay === null) {
        return dispatch({ type: 'failed', runId, error: retries > 0 ? withGiveUp(error, retries, waited) : error, at: deps.now() })
      }
      retries++
      waited += delay
      dispatch({ type: 'retrying', runId, error, retry: retries, until: deps.now() + delay, waitedMs: delay })
      if (!(await deps.sleep(delay, stop.signal))) return dispatch({ type: 'cancelled', runId, at: deps.now() })
    }
  })()

  return { cancel: () => { stop.abort(); display.cancel() } }
}

/** The final error says how hard we tried: "unavailable for 3 retries over about 7 seconds". */
function withGiveUp(error: ApiError, retries: number, waitedMs: number): ApiError {
  return { ...error, details: { ...error.details, gaveUpAfterRetries: retries, waitedMs: Math.round(waitedMs) } }
}

async function runAttempt(
  a: RunArgs & { requestId: string; attempt: number; simulate: string | null },
  onToken: (text: string) => void,
  signal: AbortSignal,
  deps: RunDeps,
): Promise<Outcome> {
  let res: Response
  try {
    const query = a.simulate ? `?_simulate=${encodeURIComponent(a.simulate)}` : ''
    res = await deps.fetch(`/api/chat${query}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Run-Id': a.runId,
        'X-Request-Id': a.requestId,
        'X-Attempt': String(a.attempt),
        ...(a.fault ? { 'X-Fault': a.fault } : {}),
      },
      body: JSON.stringify(a.request),
      signal,
    })
  } catch {
    if (signal.aborted) return { kind: 'cancelled' }
    return { kind: 'error', tokens: 0, error: browserError(a, deps.isOnline() ? 'unreachable' : 'offline') }
  }

  if (!res.ok || !res.body) {
    const body = (await res.json().catch(() => undefined)) as ApiErrorBody | undefined
    return {
      kind: 'error',
      tokens: 0,
      error: body?.error ?? {
        type: 'internal_error',
        source: 'playground',
        retryable: false,
        status: res.status,
        message: `The playground server answered ${res.status}.`,
        requestId: a.requestId,
        runId: a.runId,
      },
    }
  }

  let tokens = 0
  try {
    for await (const data of readSseData(res.body)) {
      const event = JSON.parse(data) as StreamEvent
      if (event.type === 'token') {
        tokens++
        onToken(event.text)
      } else if (event.type === 'done') {
        return { kind: 'done', event }
      } else {
        return { kind: 'error', error: event.error, tokens }
      }
    }
    // The stream ended without `done` or `error`: our server or the connection went away.
    return { kind: 'error', tokens, error: browserError(a, 'dropped') }
  } catch {
    if (signal.aborted) return { kind: 'cancelled' }
    return { kind: 'error', tokens, error: browserError(a, 'dropped') }
  }
}

/** Errors only the browser can see: no answer from our server, or the connection dropped. */
function browserError(a: { requestId: string; runId: string }, what: 'offline' | 'unreachable' | 'dropped'): ApiError {
  const base = { source: 'network' as const, retryable: true, requestId: a.requestId, runId: a.runId }
  if (what === 'dropped') return { ...base, type: 'stream_interrupted', details: { reason: 'connection_dropped' }, message: 'The connection to the playground dropped.' }
  return {
    ...base,
    type: 'network_error',
    details: { reason: what },
    message: what === 'offline' ? 'The browser is offline.' : "Couldn't reach the playground server.",
  }
}

export function browserDeps(): RunDeps {
  return {
    fetch: (...args) => fetch(...args),
    now: () => Date.now(),
    random: Math.random,
    sleep: (ms, signal) =>
      new Promise((resolve) => {
        if (signal.aborted) return resolve(false)
        const timer = setTimeout(() => resolve(true), ms)
        signal.addEventListener('abort', () => (clearTimeout(timer), resolve(false)), { once: true })
      }),
    isOnline: () => navigator.onLine,
    waitForOnline: (signal) =>
      new Promise((resolve) => {
        if (signal.aborted) return resolve(false)
        const done = (value: boolean) => () => {
          window.removeEventListener('online', onOnline)
          resolve(value)
        }
        const onOnline = done(true)
        window.addEventListener('online', onOnline, { once: true })
        signal.addEventListener('abort', done(false), { once: true })
      }),
    frame: (cb) => requestAnimationFrame(cb),
    cancelFrame: (id) => cancelAnimationFrame(id),
    shouldAnimate: () => document.visibilityState !== 'hidden' && !window.matchMedia('(prefers-reduced-motion: reduce)').matches,
    newRequestId: () => newId('req'),
  }
}
