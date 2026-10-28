import { Hono } from 'hono'
import { bodyLimit } from 'hono/body-limit'
import { ChatRequestSchema } from '../../shared/chat'
import type { StreamEvent } from '../../shared/stream-events'
import type { Config } from '../config'
import type { AppEnv } from '../env'
import { errorJson } from '../errors'
import { safeId } from '../middleware/request-id'
import { buildChatRequest } from '../../shared/build-chat-request'
import { callUpstream, readUpstreamMessage } from '../upstream/client'
import { parseFault } from '../upstream/faults'
import type { ModelCatalog } from '../upstream/model-catalog'
import { normalizeUpstream } from '../upstream/normalize-stream'
import { parseSimulate } from '../upstream/simulate'
import { BrowserLeft, FaultDrop, StreamTimeout, untilAborted, Watchdog, type StreamTimings } from '../upstream/stream-guard'
import {
  badUpstreamResponse,
  firstTokenTimeout,
  streamInterrupted,
  translateUpstreamStatus,
  type UpstreamFailure,
  upstreamUnreachable,
} from '../upstream/translate-error'

const MAX_BODY_BYTES = 512 * 1024

type Deps = { config: Config; fetch: typeof fetch; catalog: ModelCatalog; now: () => number; timings: StreamTimings }

/**
 * POST /api/chat: one attempt. Validates, calls the inference API once, and
 * streams our three events back. Retrying is the browser's job (design §22.1).
 */
export function chatRoutes(deps: Deps) {
  const app = new Hono<AppEnv>()
  const { timings } = deps

  app.post(
    '/',
    bodyLimit({
      maxSize: MAX_BODY_BYTES,
      onError: (c) =>
        errorJson(c, 413, {
          type: 'invalid_request',
          source: 'playground',
          retryable: false,
          message: 'The request is larger than 512 KB.',
        }),
    }),
    async (c) => {
      const requestId = c.get('requestId')
      const runId = safeId(c.req.header('x-run-id'), 'run')
      const attempt = Number(c.req.header('x-attempt')) || 1
      const ctx = { requestId, runId, op: 'chat' as const }
      const startedAt = deps.now()

      // One log line per attempt, whatever happens: sizes and outcomes only, never content.
      // Phase 6 turns this into the full wide event.
      const logged: Record<string, unknown> = { model: null, simulate: null, fault: null, upstreamRequestId: null }
      const logAttempt = (fields: Record<string, unknown>) =>
        console.log(JSON.stringify({ event: 'chat_attempt', runId, requestId, attempt, ...logged, ...fields, durationMs: deps.now() - startedAt }))
      const failWith = (failure: UpstreamFailure) => {
        logAttempt({ outcome: 'error', status: failure.error.status ?? failure.httpStatus, error: { type: failure.error.type, source: failure.error.source } })
        return errorJson(c, failure.httpStatus, failure.error)
      }

      const parsed = ChatRequestSchema.safeParse(await c.req.json().catch(() => undefined))
      if (!parsed.success) {
        const issue = parsed.error.issues[0]
        const field = issue?.path.join('.') || undefined
        logAttempt({ outcome: 'rejected', status: 400, error: { type: 'invalid_request', source: 'playground' }, field: field ?? null })
        return errorJson(c, 400, {
          type: 'invalid_request',
          source: 'playground',
          retryable: false,
          runId,
          // The same words the browser shows under the field; `details.field` says which one.
          message: issue?.message ?? 'The request is not valid.',
          ...(field ? { details: { field } } : {}),
        })
      }
      const request = parsed.data
      logged.model = request.settings.model

      // The model must be one we list. If the list itself is unavailable, the upstream decides.
      const catalog = await deps.catalog.list(requestId).catch(() => undefined)
      const model = catalog?.models.find((m) => m.id === request.settings.model)
      if (catalog && !model) {
        logAttempt({ outcome: 'rejected', status: 400, error: { type: 'invalid_request', source: 'playground' }, field: 'settings.model' })
        return errorJson(c, 400, {
          type: 'invalid_request',
          source: 'playground',
          retryable: false,
          runId,
          message: `Unknown model: ${request.settings.model}.`,
          details: { field: 'settings.model' },
        })
      }

      const simulate = parseSimulate(c.req.query('_simulate'), deps.config.faultsEnabled)
      const fault = parseFault(c.req.header('x-fault'), deps.config.faultsEnabled)
      logged.simulate = simulate ?? null
      logged.fault = fault?.raw ?? null

      // We abort the upstream call ourselves for three reasons: the browser left (Stop,
      // closed tab: generation and billing stop too), a timeout, or a fault switch.
      const upstreamAbort = new AbortController()
      const signal = AbortSignal.any([c.req.raw.signal, upstreamAbort.signal])
      const watchdog = new Watchdog(upstreamAbort)
      watchdog.arm(timings.firstTokenMs, 'first_token')

      let upstream: Response
      try {
        upstream = await callUpstream(deps, '/v1/chat/completions', {
          method: 'POST',
          body: buildChatRequest(request),
          requestId,
          simulate,
          signal,
        })
      } catch (err) {
        watchdog.stop()
        if (upstreamAbort.signal.reason instanceof StreamTimeout) return failWith(firstTokenTimeout(ctx, timings.firstTokenMs))
        return failWith(upstreamUnreachable(err, ctx))
      }
      logged.upstreamRequestId = upstream.headers.get('x-parasail-request-id') ?? upstream.headers.get('x-request-id') ?? null
      if (!upstream.ok) {
        watchdog.stop()
        return failWith(translateUpstreamStatus(upstream.status, upstream.headers, await readUpstreamMessage(upstream), ctx))
      }
      if (!upstream.body) {
        watchdog.stop()
        return failWith(badUpstreamResponse(ctx))
      }

      const events = normalizeUpstream(upstream.body, { requestId, runId, pricing: model?.pricing ?? null })
      const encoder = new TextEncoder()

      const stream = new ReadableStream<Uint8Array>({
        async start(controller) {
          // Writes can fail once the browser has gone; that's not an error worth raising.
          const write = (text: string) => {
            try {
              controller.enqueue(encoder.encode(text))
            } catch {
              // closed
            }
          }
          const send = (event: StreamEvent) => write(`data: ${JSON.stringify(event)}\n\n`)
          const close = () => {
            try {
              controller.close()
            } catch {
              // already closed
            }
          }

          // `: ping` comments keep proxies from closing a quiet connection; clients ignore them.
          const heartbeat = setInterval(() => write(': ping\n\n'), timings.heartbeatMs)
          let outcome: 'completed' | 'interrupted' | 'client_disconnected' = 'completed'
          let tokens = 0

          try {
            // Each event is written the moment it's parsed: no buffering on our side.
            for await (const event of events) {
              if (event.type === 'token') {
                tokens++
                watchdog.arm(timings.stallMs, 'stall')
              }
              send(event)
              if (event.type !== 'token') {
                outcome = event.type === 'done' ? 'completed' : 'interrupted'
                break
              }
              if (fault && tokens === fault.tokens) {
                if (fault.kind === 'drop_after') {
                  upstreamAbort.abort(new FaultDrop())
                  send({ type: 'error', error: streamInterrupted(ctx, { reason: 'closed_early', afterTokens: tokens, fault: fault.raw }) })
                  outcome = 'interrupted'
                  break
                }
                // stall_after: stop forwarding and let the stall timeout end it, as it would for real.
                await untilAborted(signal)
                throw signal.reason
              }
            }
            close()
          } catch {
            const reason: unknown = upstreamAbort.signal.reason
            if (reason instanceof BrowserLeft || c.req.raw.signal.aborted) {
              outcome = 'client_disconnected'
            } else if (reason instanceof StreamTimeout) {
              outcome = 'interrupted'
              send({
                type: 'error',
                error:
                  tokens === 0
                    ? firstTokenTimeout(ctx, timings.firstTokenMs).error
                    : streamInterrupted(ctx, { reason: 'stall', afterTokens: tokens, stalledForMs: timings.stallMs }),
              })
            } else {
              // The upstream connection broke mid-stream (reset).
              outcome = 'interrupted'
              send({ type: 'error', error: streamInterrupted(ctx, { reason: 'connection_lost', afterTokens: tokens }) })
            }
            close()
          } finally {
            clearInterval(heartbeat)
            watchdog.stop()
            logAttempt({ outcome, status: 200, tokens })
          }
        },
        cancel() {
          upstreamAbort.abort(new BrowserLeft())
        },
      })

      return c.body(stream, 200, {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-cache, no-transform',
        'X-Accel-Buffering': 'no',
      })
    },
  )

  return app
}
