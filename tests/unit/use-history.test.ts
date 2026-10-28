// @vitest-environment happy-dom
import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { chatReducer, initialChat } from '../../src/client/chat/reducer'
import type { ChatState } from '../../src/client/chat/types'
import { createChatStore, memoryBackend } from '../../src/client/history/chat-store'
import { fromStored, toStored } from '../../src/client/history/stored-chat'
import { useHistory } from '../../src/client/history/use-history'

/** A chat whose answer has started streaming: saved at send, before any text arrived. */
function streaming(id: string): ChatState {
  const s = chatReducer(initialChat(id, 1000), { type: 'setModel', columnId: 'col_a', model: 'm' })
  return chatReducer(s, { type: 'send', columnId: 'col_a', text: 'hi', runId: `run_${id}`, requestId: 'req_1', at: 1000 })
}

const withText = (chat: ChatState, text: string) => chatReducer(chat, { type: 'tokens', runId: `run_${chat.id}`, text, at: 1200 })
const answerOf = (chat: ChatState | undefined) => chat?.columns[0]!.messages[1]
const noop = () => {}

function hideTab() {
  Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true })
  document.dispatchEvent(new Event('visibilitychange'))
}

async function reopened(store: ReturnType<typeof createChatStore>, id: string) {
  const saved = await store.get(id)
  return answerOf(saved && fromStored(saved))
}

afterEach(() => {
  cleanup()
  Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true })
  localStorage.clear()
  sessionStorage.clear()
})

describe('useHistory when the tab is hidden mid-answer', () => {
  it('saves the text shown so far', async () => {
    const store = createChatStore(memoryBackend())
    const started = streaming('chat_open')
    const hook = renderHook((chat: ChatState) => useHistory({ chat, onOpen: noop, onOpenChatDeleted: noop, skipRestore: true, store }), { initialProps: started })

    // Tokens change the chat but not `rev`, so nothing saves them until the tab hides.
    hook.rerender(withText(started, 'partial answer'))
    await act(async () => hideTab())

    expect(await reopened(store, 'chat_open')).toMatchObject({ status: 'cancelled', text: 'partial answer' })
  })

  it('also saves chats left mid-answer that are still finishing in the background', async () => {
    const store = createChatStore(memoryBackend())
    const background = [withText(streaming('chat_bg'), 'background text')]
    renderHook(() => useHistory({ chat: initialChat('chat_new'), background, onOpen: noop, onOpenChatDeleted: noop, skipRestore: true, store }))

    await act(async () => hideTab())

    expect(await reopened(store, 'chat_bg')).toMatchObject({ status: 'cancelled', text: 'background text' })
    expect(await store.get('chat_new')).toBeUndefined()
  })
})

describe('useHistory across a reload mid-answer', () => {
  it('keeps the text shown so far for the next load, which reopens the chat with it', async () => {
    const before = renderHook(() =>
      useHistory({ chat: withText(streaming('chat_open'), 'partial answer'), onOpen: noop, onOpenChatDeleted: noop, skipRestore: false, store: createChatStore(memoryBackend()) }),
    )
    act(() => void window.dispatchEvent(new Event('pagehide')))
    before.unmount()

    // IndexedDB writes made while a page unloads are dropped: the next load starts from a store without them.
    const store = createChatStore(memoryBackend())
    const onOpen = vi.fn()
    renderHook(() => useHistory({ chat: initialChat('chat_fresh'), onOpen, onOpenChatDeleted: noop, skipRestore: false, store }))

    await waitFor(() => expect(onOpen).toHaveBeenCalledOnce())
    expect(answerOf(onOpen.mock.calls[0]![0])).toMatchObject({ status: 'cancelled', text: 'partial answer' })
    expect(localStorage.getItem('playground.unsavedChats')).toBeNull()
  })

  it('does not overwrite a newer copy already in history', async () => {
    const store = createChatStore(memoryBackend())
    await store.put(toStored(withText(streaming('chat_open'), 'newer text'), 9_000_000_000_000))
    localStorage.setItem('playground.unsavedChats', JSON.stringify([toStored(withText(streaming('chat_open'), 'older text'), 5000)]))

    const hook = renderHook(() => useHistory({ chat: initialChat('chat_fresh'), onOpen: noop, onOpenChatDeleted: noop, skipRestore: true, store }))
    act(() => hook.result.current.refresh())

    await waitFor(() => expect(hook.result.current.chats).toHaveLength(1))
    expect(await reopened(store, 'chat_open')).toMatchObject({ text: 'newer text' })
  })
})
