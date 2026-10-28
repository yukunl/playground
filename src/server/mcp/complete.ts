import { buildChatRequest } from '../../shared/build-chat-request'
import type { Settings } from '../../shared/chat'
import type { Model } from '../../shared/models'
import type { Usage } from '../../shared/stream-events'
import { callUpstream, readUpstreamMessage, type UpstreamDeps } from '../upstream/client'
import { normalizeUpstream } from '../upstream/normalize-stream'
import { translateUpstreamStatus } from '../upstream/translate-error'

/** One answer for an agent, measured the way the page measures it (MessageView's stats line). */
export type Completion = {
  output: string
  finishReason?: 'stop' | 'length'
  /** From sending the attempt that succeeded to its first token. */
  ttftMs?: number
  /** From sending that attempt to its last token. */
  totalMs?: number
  /** Completion tokens over the time between the first token and the last. */
  tokensPerSecond?: number
  usage?: Usage
  /** At list prices; null when the model has no price or the API reported no usage. */
  costUsd: number | null
  retries: number
  error?: string
}

const ATTEMPTS = 3
const MAX_BACKOFF_MS = 10_000
/** The whole answer, first token to last. The page's stall and first-token timers are stricter, but an agent can wait. */
const CALL_TIMEOUT_MS = 90_000

type Deps = UpstreamDeps & {
  now: () => number
  sleep?: (ms: number, signal: AbortSignal) => Promise<void>
}

/**
 * Runs one setup on one input. A 429 or 5xx before any text is retried with
 * backoff, as the page retries it. A stream that breaks partway is reported as is.
 */
export async function measuredCompletion(
  deps: Deps,
  settings: Settings,
  input: string,
  model: Model | undefined,
  ids: { requestId: string; runId: string },
  signal: AbortSignal,
): Promise<Completion> {
  const sleep = deps.sleep ?? abortableSleep
  const body = buildChatRequest({ settings, messages: [{ role: 'user', content: input }] })

  for (let attempt = 1; ; attempt++) {
    const retries = attempt - 1
    const startedAt = deps.now()
    const callSignal = AbortSignal.any([signal, AbortSignal.timeout(CALL_TIMEOUT_MS)])

    let res: Response
    try {
      res = await callUpstream(deps, '/v1/chat/completions', { method: 'POST', body, requestId: ids.requestId, signal: callSignal })
    } catch (err) {
      if (signal.aborted) throw err
      if (attempt < ATTEMPTS) {
        await sleep(backoff(attempt), signal)
        continue
      }
      return { output: '', costUsd: null, retries, error: "Couldn't reach the inference API." }
    }

    if (!res.ok) {
      const { error } = translateUpstreamStatus(res.status, res.headers, await readUpstreamMessage(res), { ...ids, op: 'chat' }, deps.now())
      if (error.retryable && attempt < ATTEMPTS) {
        await sleep(Math.min(error.retryAfterMs ?? backoff(attempt), MAX_BACKOFF_MS), signal)
        continue
      }
      return { output: '', costUsd: null, retries, error: `${error.message} (HTTP ${res.status})` }
    }
    if (!res.body) return { output: '', costUsd: null, retries, error: 'The inference API sent an empty response.' }

    let output = ''
    let firstTokenAt: number | undefined
    let lastTokenAt: number | undefined
    try {
      for await (const event of normalizeUpstream(res.body, { ...ids, pricing: model?.pricing ?? null })) {
        if (event.type === 'token') {
          firstTokenAt ??= deps.now()
          lastTokenAt = deps.now()
          output += event.text
        } else {
          const timing = timings(startedAt, firstTokenAt, lastTokenAt ?? deps.now(), event.type === 'done' ? event.usage : undefined)
          if (event.type === 'error') return { output, costUsd: null, retries, ...timing, error: event.error.message }
          return { output, finishReason: event.finishReason, ...timing, ...(event.usage ? { usage: event.usage } : {}), costUsd: event.costUsd, retries }
        }
      }
    } catch (err) {
      if (signal.aborted) throw err
      const timeout = callSignal.aborted
      return {
        output,
        costUsd: null,
        retries,
        ...timings(startedAt, firstTokenAt, lastTokenAt ?? deps.now(), undefined),
        error: timeout ? `No complete answer within ${CALL_TIMEOUT_MS / 1000} seconds.` : 'The connection to the inference API broke.',
      }
    }
    return { output, costUsd: null, retries, error: 'The stream ended without finishing.' }
  }
}

/** Shorter than this, a short answer arrives in a burst or two and its speed is noise (a 12-token label "at 1,091 tok/s"). */
const MIN_GENERATION_MS_FOR_SPEED = 250

function timings(startedAt: number, firstTokenAt: number | undefined, lastTokenAt: number, usage: Usage | undefined) {
  if (firstTokenAt === undefined) return {}
  const generationMs = lastTokenAt - firstTokenAt
  return {
    ttftMs: firstTokenAt - startedAt,
    totalMs: lastTokenAt - startedAt,
    ...(usage && generationMs >= MIN_GENERATION_MS_FOR_SPEED ? { tokensPerSecond: Math.round(usage.completionTokens / (generationMs / 1000)) } : {}),
  }
}

const backoff = (attempt: number) => Math.min(1000 * 2 ** (attempt - 1), MAX_BACKOFF_MS)

function abortableSleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) return reject(signal.reason)
    const timer = setTimeout(resolve, ms)
    signal.addEventListener(
      'abort',
      () => {
        clearTimeout(timer)
        reject(signal.reason)
      },
      { once: true },
    )
  })
}

/**
 * At most `size` upstream calls at once, across every agent. The take-home key
 * rate-limits at four concurrent calls; Compare's two run fine.
 */
export class Limiter {
  private active = 0
  private readonly waiting: (() => void)[] = []

  constructor(private readonly size: number) {}

  async run<T>(task: () => Promise<T>): Promise<T> {
    if (this.active < this.size) this.active++
    // A finishing task hands its place straight to the next one, so no newcomer can slip in between.
    else await new Promise<void>((resolve) => this.waiting.push(resolve))
    try {
      return await task()
    } finally {
      const next = this.waiting.shift()
      if (next) next()
      else this.active--
    }
  }
}
