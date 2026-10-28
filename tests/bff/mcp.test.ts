import { describe, expect, it } from 'vitest'
import { decodeShare, readShareHash } from '../../src/client/share/share-link'
import { createApp } from '../../src/server/app'
import type { Config } from '../../src/server/config'
import type { AgentTokenResponse } from '../../src/shared/agent-token'
import { fakeUpstream, manualClock, MOCK_MODELS, mockChatStream, simulatedError, sseBody, testConfig } from '../helpers'

const PASSWORD = 'correct-horse-battery-staple'
const MODEL = 'parasail-llama-3.1-8b-instruct'
const BASE = 'http://playground.test'

type Chat = { model: string; messages: { role: string; content: string }[]; temperature: number; max_tokens: number }

/** An upstream that answers "echo: <the user's message>", and records what it was sent. */
function setup(overrides: Partial<Config> = {}, chat?: (body: Chat, n: number) => Response | undefined) {
  const sent: Chat[] = []
  const upstream = fakeUpstream((url, init) => {
    if (url.pathname === '/v1/models') return Response.json(MOCK_MODELS)
    const body = JSON.parse(String(init?.body)) as Chat
    sent.push(body)
    const special = chat?.(body, sent.length)
    if (special) return special
    const text = `echo: ${body.messages.at(-1)!.content}`
    return new Response(sseBody(mockChatStream([text.slice(0, 4), text.slice(4)], { prompt: 12, completion: 6 })), { headers: { 'Content-Type': 'text/event-stream' } })
  })
  const clock = manualClock()
  // Each reading moves the clock on a little, so timings come out above zero.
  const now = () => clock.advance(5)
  const app = createApp({ config: testConfig(overrides), fetch: upstream.fetch, now })
  return { app, sent, clock }
}

type App = ReturnType<typeof createApp>

const basic = { Authorization: `Basic ${btoa(`:${PASSWORD}`)}` }
const bearer = (token: string) => ({ Authorization: `Bearer ${token}` })

async function makeToken(app: App, headers: Record<string, string> = basic, hours = 24): Promise<AgentTokenResponse> {
  const res = await app.request(`${BASE}/api/agent-token`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify({ hours }) })
  expect(res.status).toBe(200)
  return (await res.json()) as AgentTokenResponse
}

function rpc(app: App, method: string, params: unknown = {}, headers: Record<string, string> = {}) {
  return app.request(`${BASE}/api/mcp`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', ...headers },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  })
}

type ToolResult = { content: { type: string; text: string }[]; structuredContent?: Record<string, unknown>; isError?: boolean }

async function callTool(app: App, name: string, args: unknown, headers: Record<string, string> = {}): Promise<ToolResult> {
  const res = await rpc(app, 'tools/call', { name, arguments: args }, headers)
  expect(res.status).toBe(200)
  const body = (await res.json()) as { result: ToolResult }
  return body.result
}

describe('agent tokens', () => {
  it('are made only for someone signed in, and say where to connect', async () => {
    const { app } = setup({ playgroundPassword: PASSWORD })
    const refused = await app.request(`${BASE}/api/agent-token`, { method: 'POST', body: '{}' })
    expect(refused.status).toBe(401)

    const res = await app.request(`${BASE}/api/agent-token`, { method: 'POST', headers: { ...basic, 'X-Forwarded-Proto': 'https' }, body: JSON.stringify({ hours: 168 }) })
    expect(res.headers.get('cache-control')).toBe('no-store')
    const made = (await res.json()) as AgentTokenResponse
    expect(made.token).toMatch(/^pgt_[A-Za-z0-9_-]{8}\.\d+\.[A-Za-z0-9_-]{43}$/)
    expect(made.mcpUrl).toBe('https://playground.test/api/mcp')
    expect(made.runs).toBe(300)
    expect(Date.parse(made.expiresAt) - Date.parse('2026-10-24T12:00:00Z')).toBeGreaterThan(167 * 3_600_000)
  })

  it('open the MCP endpoint and nothing else', async () => {
    const { app, sent } = setup({ playgroundPassword: PASSWORD })
    const { token } = await makeToken(app)

    expect((await rpc(app, 'initialize', {}, bearer(token))).status).toBe(200)
    expect((await app.request(`${BASE}/api/models`, { headers: bearer(token) })).status).toBe(401)
    expect((await app.request(`${BASE}/api/chat`, { method: 'POST', headers: bearer(token), body: '{}' })).status).toBe(401)
    // A token can't make another one, so it can't outlive itself.
    expect((await app.request(`${BASE}/api/agent-token`, { method: 'POST', headers: bearer(token), body: '{}' })).status).toBe(401)
    expect((await app.request(`${BASE}/`, { headers: bearer(token) })).status).toBe(302)
    expect(sent).toHaveLength(0)
  })

  it('stop working when they expire, are edited, or the password changes', async () => {
    const { app, clock } = setup({ playgroundPassword: PASSWORD })
    const { token } = await makeToken(app)
    const [head, signature] = [token.slice(0, -43), token.slice(-43)]
    const forged = head + (signature[0] === 'A' ? 'B' : 'A') + signature.slice(1)
    expect((await rpc(app, 'ping', {}, bearer(forged))).status).toBe(401)

    const { app: changed } = setup({ playgroundPassword: 'a-new-password' })
    expect((await rpc(changed, 'ping', {}, bearer(token))).status).toBe(401)

    clock.advance(24 * 3_600_000)
    const expired = await rpc(app, 'ping', {}, bearer(token))
    expect(expired.status).toBe(401)
    const { error } = (await expired.json()) as { error: { message: string } }
    expect(error.message).toContain('Make a new one in the playground')
  })

  it('each get a bounded number of runs', async () => {
    const { app } = setup({ playgroundPassword: PASSWORD })
    const { token } = await makeToken(app)
    const five = { setup: { model: MODEL }, inputs: ['a', 'b', 'c', 'd', 'e'] }
    for (let i = 0; i < 60; i++) expect((await callTool(app, 'run', five, bearer(token))).isError).toBeUndefined()

    const over = await callTool(app, 'run', { setup: { model: MODEL }, inputs: ['one more'] }, bearer(token))
    expect(over.isError).toBe(true)
    expect(over.content[0]!.text).toContain('used all its runs')
    // A fresh token starts again.
    const fresh = await makeToken(app)
    expect((await callTool(app, 'run', { setup: { model: MODEL }, inputs: ['hi'] }, bearer(fresh.token))).isError).toBeUndefined()
  })
})

describe('MCP endpoint', () => {
  it('answers initialize with the version the agent asked for, if it knows it', async () => {
    const { app } = setup()
    const res = await rpc(app, 'initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'test', version: '1' } })
    const { result } = (await res.json()) as { result: { protocolVersion: string; capabilities: unknown; serverInfo: { name: string } } }
    expect(result.protocolVersion).toBe('2025-06-18')
    expect(result.capabilities).toEqual({ tools: {} })
    expect(result.serverInfo.name).toBe('parasail-playground')

    const newer = await rpc(app, 'initialize', { protocolVersion: '2099-01-01' })
    expect(((await newer.json()) as { result: { protocolVersion: string } }).result.protocolVersion).toBe('2025-11-25')
  })

  it('takes notifications without an answer, and refuses a server stream', async () => {
    const { app } = setup()
    const note = await app.request(`${BASE}/api/mcp`, { method: 'POST', body: JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) })
    expect(note.status).toBe(202)
    const get = await app.request(`${BASE}/api/mcp`, { headers: { Accept: 'text/event-stream' } })
    expect(get.status).toBe(405)
  })

  it('lists three tools, with schemas made from the checks', async () => {
    const { app } = setup()
    const res = await rpc(app, 'tools/list')
    const { result } = (await res.json()) as { result: { tools: { name: string; inputSchema: { type: string; required?: string[] } }[] } }
    expect(result.tools.map((t) => t.name)).toEqual(['list_models', 'run', 'open_in_playground'])
    const run = result.tools.find((t) => t.name === 'run')!
    expect(run.inputSchema.type).toBe('object')
    expect(run.inputSchema.required).toEqual(['setup', 'inputs'])
  })

  it('says so for an unknown method or tool', async () => {
    const { app } = setup()
    const method = (await (await rpc(app, 'resources/list')).json()) as { error: { code: number } }
    expect(method.error.code).toBe(-32601)
    const tool = (await (await rpc(app, 'tools/call', { name: 'delete_everything' })).json()) as { error: { code: number } }
    expect(tool.error.code).toBe(-32602)
  })

  it('refuses a web page on another site', async () => {
    const { app } = setup()
    const res = await rpc(app, 'initialize', {}, { Origin: 'http://evil.test' })
    expect(res.status).toBe(403)
  })
})

describe('MCP tools', () => {
  it('list_models gives IDs and prices', async () => {
    const { app } = setup()
    const result = await callTool(app, 'list_models', {})
    const models = (result.structuredContent as { models: { id: string; pricePerMillionTokensUsd: unknown }[] }).models
    expect(models.map((m) => m.id)).toEqual(['parasail-llama-3.1-70b-instruct', MODEL])
    expect(models[1]!.pricePerMillionTokensUsd).toEqual({ input: 0.05, output: 0.1 })
  })

  it('run sends each input on its own, with the playground defaults, and measures it', async () => {
    const { app, sent } = setup()
    const result = await callTool(app, 'run', { setup: { model: MODEL, system: 'Reply with a label.', temperature: 0 }, inputs: ['first', 'second'] })

    expect(sent).toHaveLength(2)
    expect(sent[0]).toMatchObject({
      model: MODEL,
      temperature: 0,
      max_tokens: 1024,
      messages: [
        { role: 'system', content: 'Reply with a label.' },
        { role: 'user', content: 'first' },
      ],
    })
    const { settings, results, totalCostUsd } = result.structuredContent as {
      settings: Record<string, unknown>
      results: { input: number; output: string; ttftMs: number; totalMs: number; usage: unknown; costUsd: number; retries: number }[]
      totalCostUsd: number
    }
    expect(settings).toEqual({ model: MODEL, system: 'Reply with a label.', temperature: 0, topP: 1, maxTokens: 1024, stop: [] })
    expect(results.map((r) => r.output)).toEqual(['echo: first', 'echo: second'])
    expect(results[0]).toMatchObject({ input: 1, usage: { promptTokens: 12, completionTokens: 6 }, retries: 0 })
    expect(results[0]!.ttftMs).toBeGreaterThan(0)
    expect(results[0]!.totalMs).toBeGreaterThan(results[0]!.ttftMs)
    // Generated in a few milliseconds: too short for a speed that means anything.
    expect(results[0]).not.toHaveProperty('tokensPerSecond')
    expect(totalCostUsd).toBeCloseTo(2 * ((12 * 0.05 + 6 * 0.1) / 1_000_000))
  })

  it('run retries a rate-limited call, as the page does', async () => {
    const { app, sent } = setup({}, (_body, n) => (n === 1 ? simulatedError(429, { 'Retry-After': '0' }) : undefined))
    const result = await callTool(app, 'run', { setup: { model: MODEL }, inputs: ['hi'] })
    const [first] = (result.structuredContent as { results: { output: string; retries: number }[] }).results
    expect(sent).toHaveLength(2)
    expect(first).toMatchObject({ output: 'echo: hi', retries: 1 })
  })

  it('run reports a failed call without failing the others', async () => {
    const { app } = setup({}, (body) => (body.messages.at(-1)!.content === 'bad' ? simulatedError(400) : undefined))
    const result = await callTool(app, 'run', { setup: { model: MODEL }, inputs: ['good', 'bad'] })
    const { results } = result.structuredContent as { results: { output: string; error?: string }[] }
    expect(result.isError).toBeUndefined()
    expect(results[0]!.output).toBe('echo: good')
    expect(results[1]!.error).toContain('HTTP 400')
  })

  it('run refuses an unknown model or too many inputs before calling anything', async () => {
    const { app, sent } = setup()
    const unknown = await callTool(app, 'run', { setup: { model: 'gpt-9' }, inputs: ['hi'] })
    expect(unknown.isError).toBe(true)
    expect(unknown.content[0]!.text).toContain('list_models')

    const many = await callTool(app, 'run', { setup: { model: MODEL }, inputs: ['1', '2', '3', '4', '5', '6'] })
    expect(many.isError).toBe(true)
    expect(sent).toHaveLength(0)
  })

  it('open_in_playground makes a proposal link the page accepts', async () => {
    const { app, sent } = setup()
    const result = await callTool(app, 'open_in_playground', {
      by: 'Claude Code',
      title: 'Support triage: cheapest that matched, or fastest',
      summary: '8 cases, 4 models, 32 runs, about $0.002.',
      choices: [
        { label: 'Matched 8 of 8', why: '8/8 at $0.03 per 1k requests.', setup: { model: MODEL, system: 'Triage.', temperature: 0 } },
        { label: 'Fastest', setup: { model: 'parasail-llama-3.1-70b-instruct', system: 'Triage.', temperature: 0 } },
      ],
      testQuestion: 'My invoice is wrong.',
    })

    const { url } = result.structuredContent as { url: string }
    expect(url.startsWith(`${BASE}/#s=`)).toBe(true)
    expect(result.content[0]!.text).toContain(url)
    const payload = await decodeShare(readShareHash(new URL(url).hash)!)
    expect(payload.proposal).toEqual({ by: 'Claude Code', title: 'Support triage: cheapest that matched, or fastest', summary: '8 cases, 4 models, 32 runs, about $0.002.' })
    expect(payload.columns.map((c) => c.label)).toEqual(['Matched 8 of 8', 'Fastest'])
    expect(payload.columns[0]!.settings).toEqual({ model: MODEL, system: 'Triage.', temperature: 0, topP: 1, maxTokens: 1024, stop: [] })
    expect(payload.columns.every((c) => c.messages === undefined)).toBe(true)
    expect(payload.draft).toBe('My invoice is wrong.')
    // Making a link runs nothing.
    expect(sent).toHaveLength(0)
  })

  it('open_in_playground refuses a model the playground doesn’t list', async () => {
    const { app } = setup()
    const result = await callTool(app, 'open_in_playground', { by: 'Codex', title: 'T', choices: [{ setup: { model: 'gpt-9' } }] })
    expect(result.isError).toBe(true)
  })
})
