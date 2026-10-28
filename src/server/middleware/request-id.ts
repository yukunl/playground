import type { MiddlewareHandler } from 'hono'
import type { AppEnv } from '../env'

const VALID_ID = /^[A-Za-z0-9_-]{1,128}$/

/**
 * Every request gets an ID: the browser's `X-Request-Id` if it looks sane,
 * otherwise a new one. It's echoed back, forwarded upstream, and logged.
 */
export function requestId(): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const id = safeId(c.req.header('x-request-id'), 'req')
    c.set('requestId', id)
    c.header('X-Request-Id', id)
    await next()
  }
}

/** Keeps a client-supplied ID if it's safe to log and forward; otherwise makes one. */
export function safeId(incoming: string | undefined, prefix: 'req' | 'run'): string {
  return incoming && VALID_ID.test(incoming) ? incoming : `${prefix}_${crypto.randomUUID().replaceAll('-', '').slice(0, 20)}`
}
