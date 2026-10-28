import type { Context } from 'hono'
import type { AppEnv } from './env'

/**
 * The playground's address as the caller sees it, for links and the MCP URL.
 * Fly ends TLS at its proxy, so the protocol comes from X-Forwarded-Proto.
 */
export function publicOrigin(c: Context<AppEnv>): string {
  const url = new URL(c.req.url)
  const proto = c.req.header('x-forwarded-proto')?.split(',')[0]?.trim()
  return proto === 'https' || proto === 'http' ? `${proto}://${url.host}` : url.origin
}

/**
 * False when a web page on another site sent this; agents send no Origin. It
 * doesn't stop DNS rebinding, where Origin and Host both name the attacker's
 * site. The gate does: such a page has neither the cookie nor a token.
 */
export function sameOrigin(c: Context<AppEnv>): boolean {
  const origin = c.req.header('origin')
  if (!origin) return true
  try {
    return new URL(origin).host === new URL(c.req.url).host
  } catch {
    return false
  }
}
