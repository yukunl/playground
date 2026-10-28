import { describe, expect, it } from 'vitest'
import { chatReducer, initialChat } from '../../src/client/chat/reducer'
import type { ChatState } from '../../src/client/chat/types'
import { relativeTime } from '../../src/client/format'
import { createChatStore, memoryBackend } from '../../src/client/history/chat-store'
import { fromStored, readStoredChat, titleOf, toStored, type StoredChat } from '../../src/client/history/stored-chat'

/** A chat with one finished answer, or one still streaming. */
function chatWith(text: string, { id = 'chat_1', streaming = false } = {}): ChatState {
  let s = chatReducer(initialChat(id, 1000), { type: 'setModel', columnId: 'col_a', model: 'm' })
  s = chatReducer(s, { type: 'send', columnId: 'col_a', text, runId: `run_${id}`, requestId: 'req_1', at: 1000 })
  s = chatReducer(s, { type: 'tokens', runId: `run_${id}`, text: 'partial answer', at: 1200 })
  if (!streaming) s = chatReducer(s, { type: 'done', runId: `run_${id}`, finishReason: 'stop', costUsd: null, at: 1300 })
  return s
}

const stored = (id: string, updatedAt: number): StoredChat => ({ ...toStored(chatWith('hi', { id }), updatedAt) })

describe('stored chats', () => {
  it('round-trips a finished chat', () => {
    const chat = chatWith('Explain prompt caching')
    const saved = toStored(chat, 5000)
    expect(saved).toMatchObject({ v: 1, id: 'chat_1', title: 'Explain prompt caching', createdAt: 1000, updatedAt: 5000 })
    expect(readStoredChat(structuredClone(saved))).toEqual(saved)
    expect(fromStored(saved)).toEqual({ ...chat, rev: 0 })
  })

  it('a run saved mid-stream reopens as stopped, keeping its text', () => {
    const saved = toStored(chatWith('hi', { streaming: true }), 5000)
    const answer = fromStored(saved).columns[0]!.messages[1]
    expect(answer).toMatchObject({ role: 'assistant', status: 'cancelled', text: 'partial answer', finishedAt: 1200 })
  })

  it('the title is the first line of the first message, shortened', () => {
    expect(titleOf(chatWith('  Summarize   this\nsecond line'))).toBe('Summarize this')
    expect(titleOf(chatWith('x'.repeat(100)))).toHaveLength(60)
    expect(titleOf(initialChat())).toBe('Untitled chat')
  })

  it('records that are missing fields, from another version, or not chats are rejected', () => {
    const good = stored('chat_1', 1)
    expect(readStoredChat({ ...good, v: 2 })).toBeUndefined()
    expect(readStoredChat({ ...good, columns: [] })).toBeUndefined()
    expect(readStoredChat({ ...good, columns: [{ ...good.columns[0], messages: [{ role: 'robot' }] }] })).toBeUndefined()
    expect(readStoredChat('hello')).toBeUndefined()
  })
})

describe('chat store', () => {
  it('lists newest first, with the summary the panel shows', async () => {
    const store = createChatStore(memoryBackend())
    await store.put(stored('chat_old', 100))
    await store.put(stored('chat_new', 200))
    const list = await store.list()
    expect(list.map((c) => c.id)).toEqual(['chat_new', 'chat_old'])
    expect(list[0]).toEqual({ id: 'chat_new', title: 'hi', updatedAt: 200, model: 'm', compare: false, sharedFrom: false, proposal: false })
  })

  it('keeps only the newest `max` chats', async () => {
    const store = createChatStore(memoryBackend(), 3)
    for (let i = 1; i <= 5; i++) await store.put(stored(`chat_${i}`, i))
    expect((await store.list()).map((c) => c.id)).toEqual(['chat_5', 'chat_4', 'chat_3'])
  })

  it('skips a record it cannot read instead of failing the whole list', async () => {
    const kv = memoryBackend()
    await kv.set('chat_bad', { v: 99 })
    const store = createChatStore(kv)
    await store.put(stored('chat_ok', 1))
    expect((await store.list()).map((c) => c.id)).toEqual(['chat_ok'])
  })

  it('delete, put back (undo) and clear', async () => {
    const store = createChatStore(memoryBackend())
    await store.put(stored('chat_a', 1))
    await store.put(stored('chat_b', 2))
    const removed = await store.get('chat_a')
    await store.delete('chat_a')
    expect((await store.list()).map((c) => c.id)).toEqual(['chat_b'])
    await store.put(removed!)
    expect((await store.list()).map((c) => c.id)).toEqual(['chat_b', 'chat_a'])
    await store.clear()
    expect(await store.list()).toEqual([])
  })
})

describe('relativeTime', () => {
  const now = new Date('2026-10-25T12:00:00').getTime()
  it.each([
    [now - 10_000, 'just now'],
    [now - 5 * 60_000, '5 min ago'],
    [now - 3 * 3_600_000, '3 h ago'],
    [now - 30 * 3_600_000, 'yesterday'],
    [now - 4 * 86_400_000, '4 days ago'],
    [new Date('2026-10-01T09:00:00').getTime(), 'Oct 1'],
    [new Date('2025-12-31T09:00:00').getTime(), 'Dec 31, 2025'],
  ])('%s → %s', (at, expected) => {
    expect(relativeTime(at, now)).toBe(expected)
  })
})
