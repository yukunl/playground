import { describe, expect, it } from 'vitest'
import { buildChatRequest } from '../../src/shared/build-chat-request'
import type { ChatRequest } from '../../src/shared/chat'

const request: ChatRequest = {
  settings: { model: 'm', system: 'Be brief.', temperature: 0.3, topP: 0.9, maxTokens: 256, stop: ['###'], seed: 7 },
  messages: [{ role: 'user', content: 'hi' }],
}

describe('buildChatRequest', () => {
  it('puts the system prompt first and maps every setting to its API field', () => {
    expect(buildChatRequest(request)).toEqual({
      model: 'm',
      messages: [
        { role: 'system', content: 'Be brief.' },
        { role: 'user', content: 'hi' },
      ],
      temperature: 0.3,
      top_p: 0.9,
      max_tokens: 256,
      stop: ['###'],
      seed: 7,
      stream: true,
      stream_options: { include_usage: true },
    })
  })

  it('sends no system message, stop or seed when they are empty', () => {
    const body = buildChatRequest({ ...request, settings: { ...request.settings, system: '', stop: [], seed: undefined } })
    expect(body.messages).toEqual([{ role: 'user', content: 'hi' }])
    expect(body).not.toHaveProperty('stop')
    expect(body).not.toHaveProperty('seed')
  })

  it('is byte-identical for the same input, so a retry can reuse the prefix cache', () => {
    expect(JSON.stringify(buildChatRequest(request))).toBe(JSON.stringify(buildChatRequest(structuredClone(request))))
  })
})
