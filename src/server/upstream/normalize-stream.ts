import { z } from 'zod'
import { costUsd } from '../../shared/chat'
import type { ModelPricing } from '../../shared/models'
import { readSseData } from '../../shared/sse'
import type { StreamEvent, Usage } from '../../shared/stream-events'
import { streamInterrupted } from './translate-error'

const UpstreamChunk = z.looseObject({
  choices: z
    .array(
      z.looseObject({
        delta: z.looseObject({ content: z.string().nullish() }).nullish(),
        finish_reason: z.string().nullish(),
      }),
    )
    .nullish(),
  usage: z
    .looseObject({
      prompt_tokens: z.number(),
      completion_tokens: z.number(),
      prompt_tokens_details: z.looseObject({ cached_tokens: z.number().optional() }).nullish(),
    })
    .nullish(),
  error: z.unknown().optional(),
})

type Context = { requestId: string; runId: string; pricing: ModelPricing | null }

/**
 * Turns the upstream's OpenAI-format stream into our three events:
 * `token` for each piece of text, then `done` (with usage and cost) at `[DONE]`,
 * or `error` if the stream breaks first.
 *
 * Checked against the mock: the first chunk carries only `delta.role`, and
 * `finish_reason` and `usage` arrive together in the last chunk before `[DONE]`.
 */
export async function* normalizeUpstream(body: ReadableStream<Uint8Array>, ctx: Context): AsyncGenerator<StreamEvent> {
  const errorCtx = { requestId: ctx.requestId, runId: ctx.runId, op: 'chat' as const }
  let finishReason: 'stop' | 'length' = 'stop'
  let usage: Usage | undefined
  let tokens = 0

  for await (const data of readSseData(body)) {
    if (data === '[DONE]') {
      yield { type: 'done', finishReason, ...(usage ? { usage } : {}), costUsd: costUsd(usage, ctx.pricing) }
      return
    }

    let json: unknown
    try {
      json = JSON.parse(data)
    } catch {
      yield { type: 'error', error: streamInterrupted(errorCtx, { reason: 'bad_chunk', afterTokens: tokens }) }
      return
    }
    const parsed = UpstreamChunk.safeParse(json)
    if (!parsed.success || parsed.data.error !== undefined) {
      yield { type: 'error', error: streamInterrupted(errorCtx, { reason: 'upstream_error', afterTokens: tokens }) }
      return
    }

    const chunk = parsed.data
    const choice = chunk.choices?.[0]
    const text = choice?.delta?.content
    if (text) {
      tokens++
      yield { type: 'token', text }
    }
    if (choice?.finish_reason) finishReason = choice.finish_reason === 'length' ? 'length' : 'stop'
    if (chunk.usage) {
      usage = {
        promptTokens: chunk.usage.prompt_tokens,
        completionTokens: chunk.usage.completion_tokens,
        ...(chunk.usage.prompt_tokens_details?.cached_tokens !== undefined
          ? { cachedTokens: chunk.usage.prompt_tokens_details.cached_tokens }
          : {}),
      }
    }
  }

  // The connection closed cleanly, but without [DONE].
  yield { type: 'error', error: streamInterrupted(errorCtx, { reason: 'closed_early', afterTokens: tokens }) }
}
