import { describe, expect, it } from 'vitest'
import { DEFAULT_SETTINGS } from '../../src/shared/chat'
import type { AssistantMessage, Column } from '../../src/client/chat/types'
import { chatUsage, columnUsage, formatUsage, panelUsages } from '../../src/client/usage'

const settings = { ...DEFAULT_SETTINGS, model: 'm' }
const answer = (over: Partial<AssistantMessage>): AssistantMessage => ({
  role: 'assistant',
  runId: 'r',
  requestId: 'q',
  text: '',
  status: 'done',
  settingsUsed: settings,
  startedAt: 0,
  attempts: [],
  ...over,
})
const column = (...messages: AssistantMessage[]): Column => ({ id: 'col_a', settings, messages: [{ role: 'user', text: 'hi' }, ...messages] })

describe('usage', () => {
  it('adds reported prompt and completion tokens, and costs', () => {
    const col = column(
      answer({ usage: { promptTokens: 10, completionTokens: 30 }, costUsd: 0.0001 }),
      answer({ usage: { promptTokens: 50, completionTokens: 20 }, costUsd: 0.0002 }),
    )
    const u = columnUsage(col)
    expect(u).toMatchObject({ tokens: 110, estimated: false })
    expect(u.costUsd).toBeCloseTo(0.0003, 10)
  })

  it('estimates an answer with no usage report from its text, and says so', () => {
    const u = columnUsage(column(answer({ text: 'x'.repeat(40), status: 'cancelled' })))
    expect(u).toEqual({ tokens: 10, costUsd: 0, estimated: true })
    expect(formatUsage(u)).toEqual(['≈10 tokens'])
  })

  it("doesn't count the answers a second panel copied from the first", () => {
    const a = column(answer({ runId: 'r1', usage: { promptTokens: 10, completionTokens: 10 }, costUsd: 0.1 }))
    const b = {
      ...column(answer({ runId: 'r1', usage: { promptTokens: 10, completionTokens: 10 }, costUsd: 0.1 }), answer({ runId: 'r2', usage: { promptTokens: 5, completionTokens: 5 }, costUsd: 0.2 })),
      id: 'col_b',
    }
    expect(panelUsages([a, b]).map((u) => u.tokens)).toEqual([20, 10])
    expect(chatUsage([a, b]).tokens).toBe(30)
  })

  it('totals both panels', () => {
    const a = column(answer({ usage: { promptTokens: 1, completionTokens: 2 }, costUsd: 0.5 }))
    const b = { ...column(answer({ runId: 'r_b', text: 'abcd' })), id: 'col_b' }
    expect(chatUsage([a, b])).toEqual({ tokens: 4, costUsd: 0.5, estimated: true })
    expect(formatUsage(chatUsage([a, b]))).toEqual(['≈4 tokens', '≈$0.50'])
  })
})
