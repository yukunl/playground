import type { ApiError } from '../../shared/api-error'

/** A failure on the way to or from the inference API, already in our error shape. */
export class UpstreamFailure extends Error {
  constructor(
    readonly httpStatus: number,
    readonly error: ApiError,
  ) {
    super(error.message)
  }
}

type Context = {
  requestId: string
  runId?: string
  /** A 404 means "no such model" for chat, but "wrong base URL" for the model list. */
  op: 'models' | 'chat'
}

/**
 * Turns an upstream HTTP failure into our error shape (design §22.4).
 * Goes by status code, never by body shape: the mock's simulated errors and the
 * real API's errors look different.
 */
export function translateUpstreamStatus(
  status: number,
  headers: Headers,
  upstreamMessage: string | undefined,
  ctx: Context,
  now: number = Date.now(),
): UpstreamFailure {
  const base = { requestId: ctx.requestId, ...(ctx.runId ? { runId: ctx.runId } : {}), status }

  if (status === 401 || status === 403) {
    // Visitors don't have keys: a rejected key is our configuration, never theirs.
    return new UpstreamFailure(502, {
      ...base,
      type: 'service_misconfigured',
      source: 'playground',
      retryable: false,
      message: `The inference API rejected the playground's credentials (${status}).`,
    })
  }

  if (status === 429) {
    const retryAfterMs = parseRetryAfter(headers.get('retry-after'), now)
    return new UpstreamFailure(429, {
      ...base,
      type: 'rate_limited',
      source: 'inference',
      retryable: true,
      ...(retryAfterMs === undefined ? {} : { retryAfterMs }),
      message: 'The inference API is rate-limiting the playground.',
    })
  }

  if (status === 404) {
    return ctx.op === 'chat'
      ? new UpstreamFailure(404, {
          ...base,
          type: 'model_not_found',
          source: 'inference',
          retryable: false,
          message: upstreamMessage ?? 'The inference API does not know this model.',
        })
      : new UpstreamFailure(502, {
          ...base,
          type: 'service_misconfigured',
          source: 'playground',
          retryable: false,
          message: 'The inference API has no model list at the configured base URL (404).',
        })
  }

  if (status >= 500) {
    return new UpstreamFailure([500, 502, 503, 504].includes(status) ? status : 502, {
      ...base,
      type: 'inference_unavailable',
      source: 'inference',
      retryable: true,
      message: `The inference API is temporarily unavailable (${status}).`,
    })
  }

  // Any other 4xx: the inference API rejected the request itself. Its wording
  // describes the user's own input, so it's safe to show them.
  const isContextError = /context|too long|maximum.*tokens/i.test(upstreamMessage ?? '')
  return new UpstreamFailure(400, {
    ...base,
    type: isContextError ? 'context_too_long' : 'invalid_request',
    source: 'inference',
    retryable: false,
    message: upstreamMessage ?? `The inference API rejected the request (${status}).`,
  })
}

/** fetch() itself failed: no response at all, or no response in time. */
export function upstreamUnreachable(err: unknown, ctx: Context): UpstreamFailure {
  const timedOut = err instanceof Error && err.name === 'TimeoutError'
  return new UpstreamFailure(timedOut ? 504 : 502, {
    requestId: ctx.requestId,
    ...(ctx.runId ? { runId: ctx.runId } : {}),
    type: 'inference_unavailable',
    source: 'inference',
    retryable: true,
    details: { reason: timedOut ? 'timeout' : 'unreachable' },
    message: timedOut ? "The inference API didn't respond in time." : "Couldn't reach the inference API.",
  })
}

/** A 2xx whose body we couldn't read. Not retried: it's unlikely to fix itself. */
export function badUpstreamResponse(ctx: Context): UpstreamFailure {
  return new UpstreamFailure(502, {
    requestId: ctx.requestId,
    ...(ctx.runId ? { runId: ctx.runId } : {}),
    type: 'inference_unavailable',
    source: 'inference',
    retryable: false,
    details: { reason: 'bad_response' },
    message: 'The inference API sent a response the playground could not read.',
  })
}

/** No first token in time. Nothing reached the screen, so it's safe to retry automatically. */
export function firstTokenTimeout(ctx: Context, afterMs: number): UpstreamFailure {
  return new UpstreamFailure(504, {
    requestId: ctx.requestId,
    ...(ctx.runId ? { runId: ctx.runId } : {}),
    type: 'inference_unavailable',
    source: 'inference',
    retryable: true,
    details: { reason: 'timeout', afterMs },
    message: `The inference API didn't start responding within ${Math.round(afterMs / 1000)} seconds.`,
  })
}

/** The stream ended or broke before `[DONE]`. Retried only if the user asks: tokens may already be on screen. */
export function streamInterrupted(ctx: Context, details: Record<string, unknown>): ApiError {
  return {
    requestId: ctx.requestId,
    ...(ctx.runId ? { runId: ctx.runId } : {}),
    type: 'stream_interrupted',
    source: 'inference',
    retryable: true,
    details,
    message: 'The inference API stopped the response before it finished.',
  }
}

/** `Retry-After` is either seconds or an HTTP date. */
export function parseRetryAfter(value: string | null, now: number = Date.now()): number | undefined {
  if (!value) return undefined
  if (/^\d+$/.test(value.trim())) return Number(value.trim()) * 1000
  const date = Date.parse(value)
  return Number.isNaN(date) ? undefined : Math.max(0, date - now)
}
