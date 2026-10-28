import { describe, expect, it } from 'vitest'
import type { ApiErrorBody } from '../../src/shared/api-error'
import type { ChatRequest } from '../../src/shared/chat'
import { createApp } from '../../src/server/app'
import { fakeUpstream, MOCK_MODELS, mockChatStream, sseBody, testConfig } from '../helpers'

const PASSWORD = 'correct-horse-battery-staple'

const request: ChatRequest = {
  settings: { model: 'parasail-llama-3.1-8b-instruct', system: '', temperature: 0.7, topP: 1, maxTokens: 64, stop: [] },
  messages: [{ role: 'user', content: 'Hi' }],
}

function setup(password = PASSWORD) {
  const upstream = fakeUpstream((url) =>
    url.pathname === '/v1/models'
      ? Response.json(MOCK_MODELS)
      : new Response(sseBody(mockChatStream(['Hello'], { prompt: 5, completion: 1 })), { headers: { 'Content-Type': 'text/event-stream' } }),
  )
  const app = createApp({ config: testConfig({ playgroundPassword: password }), fetch: upstream.fetch })
  return { app, calls: upstream.calls }
}

type App = ReturnType<typeof createApp>

const basic = (username: string, password: string) => ({ Authorization: `Basic ${btoa(`${username}:${password}`)}` })

function postChat(app: App, headers: Record<string, string> = {}) {
  return app.request('/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Request-Id': 'req_gate', ...headers },
    body: JSON.stringify(request),
  })
}

function signIn(app: App, password: string, headers: Record<string, string> = {}) {
  return app.request('/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify({ password }) })
}

/** The cookie a sign-in set, ready to send back. */
const cookieFrom = (res: Response) => res.headers.get('set-cookie')!.split(';')[0]!

describe('preview gate', () => {
  it('turns away a direct call to /api/chat without the password, before the key is ever used', async () => {
    const { app, calls } = setup()
    const res = await postChat(app)

    expect(res.status).toBe(401)
    // No challenge, so browsers never show their own password dialog.
    expect(res.headers.get('www-authenticate')).toBeNull()
    const { error } = (await res.json()) as ApiErrorBody
    expect(error).toMatchObject({ type: 'unauthorized', source: 'playground', retryable: false, requestId: 'req_gate' })
    expect(calls).toHaveLength(0)
  })

  it('signs a browser in with a cookie that opens the API', async () => {
    const { app } = setup()
    const res = await signIn(app, PASSWORD)

    expect(res.status).toBe(204)
    const setCookie = res.headers.get('set-cookie')!
    expect(setCookie).toMatch(/^playground_session=/)
    expect(setCookie).toMatch(/HttpOnly/)
    expect(setCookie).toMatch(/SameSite=Lax/)
    expect(setCookie).not.toMatch(/Secure/)
    expect(setCookie).not.toContain(PASSWORD)

    const chat = await postChat(app, { Cookie: cookieFrom(res) })
    expect(chat.status).toBe(200)
    expect(await chat.text()).toContain('Hello')
  })

  it('marks the cookie Secure behind an HTTPS proxy like Fly’s', async () => {
    const { app } = setup()
    const res = await signIn(app, PASSWORD, { 'X-Forwarded-Proto': 'https' })
    expect(res.headers.get('set-cookie')).toMatch(/Secure/)
  })

  it('refuses a wrong password, and sets no cookie', async () => {
    const { app } = setup()
    const res = await signIn(app, 'not-the-password-at-all')

    expect(res.status).toBe(401)
    expect(res.headers.get('set-cookie')).toBeNull()
    expect(((await res.json()) as ApiErrorBody).error.type).toBe('unauthorized')
  })

  it('signs everyone out when the password changes', async () => {
    const before = setup()
    const cookie = cookieFrom(await signIn(before.app, PASSWORD))
    const after = setup('a-brand-new-password-for-review')

    expect((await after.app.request('/api/models', { headers: { Cookie: cookie } })).status).toBe(401)
    expect((await after.app.request('/api/models', { headers: { Cookie: 'playground_session=made-up' } })).status).toBe(401)
  })

  it('lets scripts send the password as Basic Auth, with any username', async () => {
    const { app } = setup()

    expect((await app.request('/api/models', { headers: basic('', PASSWORD) })).status).toBe(200)
    expect((await postChat(app, basic('anyone', PASSWORD))).status).toBe(200)
    expect((await app.request('/api/models', { headers: basic('anyone', 'not-the-password-at-all') })).status).toBe(401)
  })

  it('leaves health open for the platform’s checks', async () => {
    const { app } = setup()
    expect((await app.request('/api/health')).status).toBe(200)
  })

  it('sends a signed-out visitor to the sign-in page, and back to where they were', async () => {
    const { app } = setup()

    const page = await app.request('/?debug')
    expect(page.status).toBe(302)
    expect(page.headers.get('location')).toBe('/login?next=%2F%3Fdebug')

    const login = await app.request('/login')
    expect(login.status).toBe(200)
    expect(login.headers.get('content-type')).toMatch(/^text\/html/)
    expect(await login.text()).toContain('autocomplete="current-password"')
  })
})
