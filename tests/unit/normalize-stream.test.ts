import { describe, expect, it } from 'vitest'
import type { ModelPricing } from '../../src/shared/models'
import type { StreamEvent } from '../../src/shared/stream-events'
import { normalizeUpstream } from '../../src/server/upstream/normalize-stream'
import { mockChatStream, sseBody } from '../helpers'

const ctx: { requestId: string; runId: string; pricing: ModelPricing | null } = {
  requestId: 'req_1',
  runId: 'run_1',
  pricing: { inputPerMtokUsd: 0.05, outputPerMtokUsd: 0.1 },
}

async function events(body: ReadableStream<Uint8Array>, context = ctx): Promise<StreamEvent[]> {
  const out: StreamEvent[] = []
  for await (const e of normalizeUpstream(body, context)) out.push(e)
  return out
}

describe('normalizeUpstream', () => {
  it('turns the mock’s stream into tokens, then done with usage and cost', async () => {
    const out = await events(sseBody(mockChatStream(['Prompt ', 'caching ', 'helps.'], { prompt: 42, completion: 180 })))
    expect(out).toEqual([
      { type: 'token', text: 'Prompt ' },
      { type: 'token', text: 'caching ' },
      { type: 'token', text: 'helps.' },
      {
        type: 'done',
        finishReason: 'stop',
        usage: { promptTokens: 42, completionTokens: 180 },
        costUsd: (42 * 0.05 + 180 * 0.1) / 1_000_000,
      },
    ])
  })

  it('reports a cut-off answer as finishReason length', async () => {
    const out = await events(sseBody(mockChatStream(['a'], { prompt: 1, completion: 1 }, 'length')))
    expect(out.at(-1)).toMatchObject({ type: 'done', finishReason: 'length' })
  })

  it('has no cost when there is no price, and no usage when none was reported', async () => {
    const chunks = [{ choices: [{ delta: { content: 'hi' } }] }, { choices: [{ delta: {}, finish_reason: 'stop' }] }]
    const out = await events(sseBody([...chunks.map((c) => JSON.stringify(c)), '[DONE]']), { ...ctx, pricing: null })
    expect(out.at(-1)).toEqual({ type: 'done', finishReason: 'stop', costUsd: null })
  })

  it('a stream that closes without [DONE] ends in stream_interrupted', async () => {
    const lines = mockChatStream(['Prompt ', 'caching'], { prompt: 1, completion: 2 }).slice(0, 3) // no final chunk, no [DONE]
    const out = await events(sseBody(lines))
    expect(out.map((e) => e.type)).toEqual(['token', 'token', 'error'])
    expect(out.at(-1)).toMatchObject({
      error: { type: 'stream_interrupted', source: 'inference', retryable: true, runId: 'run_1', details: { reason: 'closed_early', afterTokens: 2 } },
    })
  })

  it('an in-stream upstream error ends in stream_interrupted', async () => {
    const out = await events(sseBody([JSON.stringify({ choices: [{ delta: { content: 'a' } }] }), JSON.stringify({ error: { message: 'overloaded' } })]))
    expect(out.at(-1)).toMatchObject({ type: 'error', error: { type: 'stream_interrupted', details: { reason: 'upstream_error' } } })
  })

  it('an unreadable chunk ends in stream_interrupted rather than silently losing text', async () => {
    const out = await events(sseBody(['{not json']))
    expect(out).toMatchObject([{ type: 'error', error: { details: { reason: 'bad_chunk' } } }])
  })
})
