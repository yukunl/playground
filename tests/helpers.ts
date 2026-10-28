import type { Config } from '../src/server/config'

export function testConfig(overrides: Partial<Config> = {}): Config {
  return {
    port: 0,
    parasailBaseUrl: 'http://mock.test',
    parasailApiKey: 'psk-mock-mockkey',
    upstreamKind: 'mock',
    faultsEnabled: true,
    version: 'test',
    playgroundPassword: undefined,
    ...overrides,
  }
}

type Handler = (url: URL, init?: RequestInit) => Response | Promise<Response>

/** A stand-in for the inference API that records every call. */
export function fakeUpstream(handler: Handler) {
  const calls: { url: URL; init?: RequestInit }[] = []
  const fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(input instanceof Request ? input.url : String(input))
    calls.push({ url, init })
    return handler(url, init)
  }) as typeof globalThis.fetch
  return { fetch, calls }
}

/** Shaped like the mock's GET /v1/models (seed-data.json), including the non-chat model. */
export const MOCK_MODELS = {
  object: 'list',
  data: [
    {
      id: 'parasail-llama-3.1-70b-instruct',
      object: 'model',
      owned_by: 'parasail',
      context_length: 131072,
      capabilities: ['chat', 'tool_use'],
      pricing: { input_per_mtok_usd: 0.4, output_per_mtok_usd: 0.8 },
    },
    {
      id: 'parasail-llama-3.1-8b-instruct',
      object: 'model',
      owned_by: 'parasail',
      context_length: 131072,
      capabilities: ['chat'],
      pricing: { input_per_mtok_usd: 0.05, output_per_mtok_usd: 0.1 },
    },
    {
      id: 'parasail-whisper-large-v3',
      object: 'model',
      owned_by: 'parasail',
      context_length: 0,
      capabilities: ['audio_transcription'],
    },
  ],
}

/** The mock's `_simulate` error body. */
export function simulatedError(status: number, headers: Record<string, string> = {}): Response {
  return Response.json(
    { error: { type: 'simulated_error', code: status, message: `Simulated ${status} response (injected by client).` } },
    { status, headers },
  )
}

/**
 * The `data:` payloads of a chat stream shaped like the mock's: a role-only first
 * chunk, one chunk per piece of text, then finish_reason and usage together, then [DONE].
 */
export function mockChatStream(
  pieces: string[],
  usage: { prompt: number; completion: number },
  finishReason: 'stop' | 'length' = 'stop',
): string[] {
  const base = { id: 'chatcmpl-1', object: 'chat.completion.chunk', created: 1, model: 'parasail-llama-3.1-8b-instruct' }
  return [
    JSON.stringify({ ...base, choices: [{ index: 0, delta: { role: 'assistant', content: '' }, finish_reason: null }] }),
    ...pieces.map((content) => JSON.stringify({ ...base, choices: [{ index: 0, delta: { content }, finish_reason: null }] })),
    JSON.stringify({
      ...base,
      choices: [{ index: 0, delta: {}, finish_reason: finishReason }],
      usage: { prompt_tokens: usage.prompt, completion_tokens: usage.completion, total_tokens: usage.prompt + usage.completion },
    }),
    '[DONE]',
  ]
}

/** An SSE byte stream from `data:` payloads. */
export function sseBody(payloads: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder()
  return new ReadableStream({
    start(controller) {
      for (const p of payloads) controller.enqueue(encoder.encode(`data: ${p}\n\n`))
      controller.close()
    },
  })
}

/** An upstream stream the test feeds by hand. It errors when `signal` aborts, like a real fetch body. */
export function controlledStream(signal?: AbortSignal | null) {
  const encoder = new TextEncoder()
  let controller!: ReadableStreamDefaultController<Uint8Array>
  const body = new ReadableStream<Uint8Array>({
    start(c) {
      controller = c
    },
  })
  signal?.addEventListener('abort', () => controller.error(new DOMException('The operation was aborted.', 'AbortError')))
  return {
    body,
    send: (payload: string) => controller.enqueue(encoder.encode(`data: ${payload}\n\n`)),
    close: () => controller.close(),
    fail: (err: Error) => controller.error(err),
  }
}

/** A clock the test moves by hand. */
export function manualClock(start = Date.parse('2026-10-24T12:00:00Z')) {
  let t = start
  return { now: () => t, advance: (ms: number) => (t += ms) }
}
