import { createHash, createHmac, timingSafeEqual } from 'node:crypto'
import type { Context, Hono } from 'hono'
import { getCookie, setCookie } from 'hono/cookie'
import type { AgentTokens } from '../agent-token'
import type { AppEnv } from '../env'
import { errorJson } from '../errors'
import { LOGIN_PAGE } from '../login-page'

const COOKIE = 'playground_session'
const SESSION_SECONDS = 30 * 24 * 60 * 60
// Health stays open for the platform's checks, and it never calls a model.
const OPEN_PATHS = new Set(['/api/health', '/login', '/api/login'])
/** The one route an agent token opens. */
export const MCP_PATH = '/api/mcp'

/**
 * The preview gate (design §25): the page and every /api route but health need
 * the password, so nobody without it can spend the key, including by calling
 * /api/chat directly. Browsers sign in once on /login and get a cookie; scripts
 * send the password as Basic Auth instead (`curl -u :<password>`, any username).
 * Coding agents send an agent token, which opens /api/mcp only (agent-token.ts).
 */
export function previewGate(app: Hono<AppEnv>, password: string, agentTokens: AgentTokens) {
  // Derived from the password, so changing the password signs everyone out.
  const session = createHmac('sha256', password).update('playground-session-v1').digest('base64url')

  const signedIn = (c: Context<AppEnv>) => {
    const cookie = getCookie(c, COOKIE)
    if (cookie && same(cookie, session)) return true
    const basic = c.req.header('authorization')?.match(/^Basic\s+(\S+)$/i)?.[1]
    if (!basic) return false
    const decoded = Buffer.from(basic, 'base64').toString('utf8')
    const colon = decoded.indexOf(':')
    return colon >= 0 && same(decoded.slice(colon + 1), password)
  }

  app.get('/login', (c) => c.html(LOGIN_PAGE))

  app.post('/api/login', async (c) => {
    const body = (await c.req.json().catch(() => undefined)) as { password?: unknown } | undefined
    if (typeof body?.password !== 'string' || !same(body.password, password)) return unauthorized(c)
    setCookie(c, COOKIE, session, {
      path: '/',
      httpOnly: true,
      sameSite: 'Lax',
      // Fly ends TLS at its proxy, so the app itself sees plain HTTP.
      secure: c.req.header('x-forwarded-proto') === 'https' || new URL(c.req.url).protocol === 'https:',
      maxAge: SESSION_SECONDS,
    })
    return c.body(null, 204)
  })

  app.use('*', async (c, next) => {
    if (OPEN_PATHS.has(c.req.path) || signedIn(c)) return next()
    if (c.req.path === MCP_PATH) return agentTokens.fromHeader(c.req.header('authorization')) ? next() : agentUnauthorized(c)
    if (c.req.path.startsWith('/api/')) return unauthorized(c)
    // The browser keeps the #fragment across the redirect, so share links survive signing in.
    const url = new URL(c.req.url)
    return c.redirect(`/login?next=${encodeURIComponent(url.pathname + url.search)}`, 302)
  })
}

// No WWW-Authenticate header: it would make browsers show their own password dialog.
const unauthorized = (c: Context<AppEnv>) =>
  errorJson(c, 401, {
    type: 'unauthorized',
    source: 'playground',
    retryable: false,
    message: 'The playground needs its password: sign in at /login, or send it as Basic Auth.',
  })

const agentUnauthorized = (c: Context<AppEnv>) =>
  errorJson(c, 401, {
    type: 'unauthorized',
    source: 'playground',
    retryable: false,
    message: 'This needs an agent token, and the one sent is missing, expired or not valid. Make a new one in the playground: Agent → Make a token.',
  })

// Same-length digests, so the comparison takes the same time whatever was sent.
const same = (given: string, expected: string) => timingSafeEqual(digest(given), digest(expected))
const digest = (text: string) => createHash('sha256').update(text).digest()
