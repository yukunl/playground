import { describe, expect, it } from 'vitest'
import { chatReducer, duplicateColumn, historyFor, initialChat, stopStreaming } from '../../src/client/chat/reducer'
import type { AssistantMessage, ChatState } from '../../src/client/chat/types'

function sent(): ChatState {
  const withModel = chatReducer(initialChat(), { type: 'setModel', columnId: 'col_a', model: 'm' })
  return chatReducer(withModel, { type: 'send', columnId: 'col_a', text: 'hi', runId: 'run_1', requestId: 'req_1', at: 1000 })
}
const answer = (s: ChatState) => s.columns[0]!.messages[1] as AssistantMessage

describe('chatReducer', () => {
  it('send adds the user message and a streaming answer with frozen settings', () => {
    const s = sent()
    expect(s.columns[0]!.messages[0]).toEqual({ role: 'user', text: 'hi' })
    expect(answer(s)).toMatchObject({ status: 'streaming', text: '', settingsUsed: { model: 'm' }, startedAt: 1000 })
  })

  it('tokens append and record when the first one arrived', () => {
    let s = chatReducer(sent(), { type: 'tokens', runId: 'run_1', text: 'Hel', at: 1300 })
    s = chatReducer(s, { type: 'tokens', runId: 'run_1', text: 'lo', at: 1400 })
    expect(answer(s)).toMatchObject({ text: 'Hello', firstTokenAt: 1300 })
  })

  it('done records usage, cost and finish time', () => {
    const s = chatReducer(sent(), { type: 'done', runId: 'run_1', finishReason: 'stop', usage: { promptTokens: 1, completionTokens: 2 }, costUsd: 0.5, at: 2000 })
    expect(answer(s)).toMatchObject({ status: 'done', usage: { completionTokens: 2 }, costUsd: 0.5, finishedAt: 2000 })
  })

  it('Stop keeps the text already shown, and later events for that run are ignored', () => {
    let s = chatReducer(sent(), { type: 'tokens', runId: 'run_1', text: 'partial', at: 1300 })
    s = chatReducer(s, { type: 'cancelled', runId: 'run_1', at: 1500 })
    s = chatReducer(s, { type: 'tokens', runId: 'run_1', text: ' late', at: 1600 })
    expect(answer(s)).toMatchObject({ status: 'cancelled', text: 'partial' })
  })

  it('changing settings does not change an answer that already ran', () => {
    const s = chatReducer(sent(), { type: 'setModel', columnId: 'col_a', model: 'other' })
    expect(answer(s).settingsUsed.model).toBe('m')
    expect(s.columns[0]!.settings.model).toBe('other')
  })
})

describe('run again, settings and new chat', () => {
  function finished(): ChatState {
    let s = chatReducer(sent(), { type: 'tokens', runId: 'run_1', text: 'first answer', at: 1100 })
    return chatReducer(s, { type: 'done', runId: 'run_1', finishReason: 'stop', costUsd: null, at: 1200 })
  }

  it('rerun replaces the last answer with a new one made with the given settings, keeping the user message', () => {
    const settings = { ...finished().columns[0]!.settings, temperature: 0.2 }
    const s = chatReducer(finished(), { type: 'rerun', columnId: 'col_a', runId: 'run_2', requestId: 'req_2', settings, at: 3000 })
    const messages = s.columns[0]!.messages
    expect(messages).toHaveLength(2)
    expect(messages[0]).toEqual({ role: 'user', text: 'hi' })
    expect(messages[1]).toMatchObject({ runId: 'run_2', status: 'streaming', text: '', settingsUsed: { temperature: 0.2 } })
  })

  it('updateSettings changes the next run only; resetSettings keeps the model', () => {
    let s = chatReducer(finished(), { type: 'updateSettings', columnId: 'col_a', patch: { temperature: 1.5, stop: ['x'] } })
    expect(s.columns[0]!.settings).toMatchObject({ temperature: 1.5, stop: ['x'], model: 'm' })
    expect(answer(s).settingsUsed.temperature).toBe(0.7)

    s = chatReducer(s, { type: 'resetSettings', columnId: 'col_a' })
    expect(s.columns[0]!.settings).toMatchObject({ temperature: 0.7, stop: [], model: 'm' })
  })

  it('newChat starts a new chat with a new ID, keeping the settings', () => {
    const withSettings = chatReducer(finished(), { type: 'updateSettings', columnId: 'col_a', patch: { temperature: 0.1 } })
    const s = chatReducer(withSettings, { type: 'newChat', id: 'chat_new', at: 5000 })
    expect(s).toMatchObject({ id: 'chat_new', createdAt: 5000, rev: 0 })
    expect(s.columns[0]!.messages).toEqual([])
    expect(s.columns[0]!.settings).toMatchObject({ temperature: 0.1, model: 'm' })
  })

  it('load replaces the open chat', () => {
    const other: ChatState = { ...initialChat('chat_other', 1), sharedFrom: true }
    expect(chatReducer(finished(), { type: 'load', chat: other })).toBe(other)
  })
})

describe('rev: what history saves', () => {
  it('goes up when a run starts and ends and when settings change, never per token or retry', () => {
    const start = sent()
    const r = start.rev
    expect(r).toBeGreaterThan(0)

    let s = chatReducer(start, { type: 'attemptStarted', runId: 'run_1', requestId: 'req_1', number: 1, at: 1000 })
    s = chatReducer(s, { type: 'tokens', runId: 'run_1', text: 'a', at: 1100 })
    s = chatReducer(s, { type: 'tokens', runId: 'run_1', text: 'b', at: 1200 })
    expect(s.rev).toBe(r)

    s = chatReducer(s, { type: 'done', runId: 'run_1', finishReason: 'stop', costUsd: null, at: 1300 })
    expect(s.rev).toBe(r + 1)
    s = chatReducer(s, { type: 'updateSettings', columnId: 'col_a', patch: { temperature: 1 } })
    expect(s.rev).toBe(r + 2)
  })

  it('starts at 0 for a new chat, so an untouched chat is never saved', () => {
    expect(initialChat().rev).toBe(0)
    expect(chatReducer(sent(), { type: 'newChat', id: 'chat_x', at: 1 }).rev).toBe(0)
  })
})

describe('historyFor', () => {
  it('sends user messages and answers that produced text, but not a failed one', () => {
    let s = sent()
    s = chatReducer(s, { type: 'failed', runId: 'run_1', at: 1100, error: { type: 'inference_unavailable', source: 'inference', retryable: true, message: 'x', requestId: 'req_1' } })
    s = chatReducer(s, { type: 'send', columnId: 'col_a', text: 'again', runId: 'run_2', requestId: 'req_2', at: 2000 })
    s = chatReducer(s, { type: 'tokens', runId: 'run_2', text: 'answer', at: 2100 })
    s = chatReducer(s, { type: 'done', runId: 'run_2', finishReason: 'stop', costUsd: null, at: 2200 })

    expect(historyFor(s.columns[0]!)).toEqual([
      { role: 'user', content: 'hi' },
      { role: 'user', content: 'again' },
      { role: 'assistant', content: 'answer' },
    ])
  })
})

describe('compare columns', () => {
  const withB = () => {
    const s = sent()
    return chatReducer(s, { type: 'addColumn', column: duplicateColumn(s.columns[0]!, 'col_b') })
  }

  it('adds B (saved like any change), never a third column', () => {
    const s = withB()
    expect(s.columns.map((c) => c.id)).toEqual(['col_a', 'col_b'])
    expect(s.rev).toBe(sent().rev + 1)
    expect(chatReducer(s, { type: 'addColumn', column: duplicateColumn(s.columns[0]!, 'col_c') })).toBe(s)
  })

  it('a copied run that was still streaming shows as stopped in B, so it can never wait forever', () => {
    expect(withB().columns[1]!.messages[1]).toMatchObject({ status: 'cancelled', finishedAt: 1000 })
    expect(withB().columns[0]!.messages[1]).toMatchObject({ status: 'streaming' })
  })

  it('removes B, but never the last column', () => {
    const one = chatReducer(withB(), { type: 'removeColumn', columnId: 'col_b' })
    expect(one.columns.map((c) => c.id)).toEqual(['col_a'])
    expect(chatReducer(one, { type: 'removeColumn', columnId: 'col_a' })).toBe(one)
  })

  it('a new chat keeps the mode: both columns and their settings, with no messages', () => {
    const s = chatReducer(withB(), { type: 'updateSettings', columnId: 'col_b', patch: { temperature: 0.2 } })
    const fresh = chatReducer(s, { type: 'newChat', id: 'chat_2', at: 1 })
    expect(fresh.columns.map((c) => [c.id, c.settings.temperature, c.messages.length])).toEqual([
      ['col_a', 0.7, 0],
      ['col_b', 0.2, 0],
    ])
  })

  it('stopStreaming marks live runs stopped and leaves finished ones alone', () => {
    const col = stopStreaming(sent().columns[0]!)
    expect(col.messages[1]).toMatchObject({ status: 'cancelled' })
  })
})
