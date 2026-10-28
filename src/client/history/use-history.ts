import { useCallback, useEffect, useRef, useState } from 'react'
import { isChatBusy } from '../chat/reducer'
import type { ChatState } from '../chat/types'
import { readStorage, removeStorage, writeStorage } from '../storage'
import { defaultChatStore, type ChatStore } from './chat-store'
import { fromStored, hasMessages, readStoredChat, summarize, toStored, type ChatSummary, type StoredChat } from './stored-chat'

/** Which chat this tab had open, so a reload reopens it. A new tab or a new visit starts fresh. */
const OPEN_CHAT_KEY = 'playground.openChat'
/** A slider drag is many changes; they're saved as one write. */
const SAVE_DELAY_MS = 300

type Options = {
  /** The open chat. */
  chat: ChatState
  /** Chats left mid-answer, still finishing. Saved as they stand if the page goes away. */
  background?: ChatState[]
  /** Show a chat: picked from the list, or reopened after a reload. */
  onOpen: (chat: ChatState) => void
  /** The open chat was deleted, so a new one should start. */
  onOpenChatDeleted: () => void
  /** Don't reopen the last chat: the page was opened with a share link. */
  skipRestore: boolean
  store?: ChatStore
}

/**
 * History in this browser: saves the open chat when a run starts or
 * ends and when settings change (never per token), lists saved chats, and
 * handles open, delete with undo, and clear all.
 */
export function useHistory({ chat, background = [], onOpen, onOpenChatDeleted, skipRestore, store = defaultChatStore() }: Options) {
  const [chats, setChats] = useState<ChatSummary[]>()
  const [problem, setProblem] = useState<string>()
  const [deleted, setDeleted] = useState<StoredChat>()
  const [restoreId] = useState(() => (skipRestore ? null : readSession(OPEN_CHAT_KEY)))
  const [restoring, setRestoring] = useState(restoreId !== null)

  const chatRef = useRef(chat)
  chatRef.current = chat
  const backgroundRef = useRef(background)
  backgroundRef.current = background
  const callbacks = useRef({ onOpen, onOpenChatDeleted })
  callbacks.current = { onOpen, onOpenChatDeleted }

  // ── Saving ────────────────────────────────────────────────────────────────
  const pending = useRef<ChatState | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined)

  const put = useCallback(
    (toSave: ChatState) => {
      const record = toStored(toSave, Date.now())
      store.put(record).then(
        () => setChats((prev) => prev && [summarize(record), ...prev.filter((c) => c.id !== record.id)]),
        (err: unknown) => setProblem(saveProblem(err)),
      )
    },
    [store],
  )

  const flush = useCallback(() => {
    clearTimeout(timer.current)
    const toSave = pending.current
    pending.current = null
    if (toSave) put(toSave)
  }, [put])

  /**
   * Saves a chat that isn't open: one that finished in the background. A queued save of
   * the same chat is dropped first, so its older, still-streaming copy can't land last.
   */
  const saveNow = useCallback(
    (toSave: ChatState) => {
      if (pending.current?.id === toSave.id) {
        clearTimeout(timer.current)
        pending.current = null
      }
      if (hasMessages(toSave)) put(toSave)
    },
    [put],
  )

  // `chat` changes with every token; `rev` changes only when there's something worth saving.
  useEffect(() => {
    const current = chatRef.current
    if (current.rev === 0 || !hasMessages(current)) return
    if (pending.current && pending.current.id !== current.id) flush()
    pending.current = current
    clearTimeout(timer.current)
    timer.current = setTimeout(flush, SAVE_DELAY_MS)
  }, [chat.id, chat.rev, flush])

  // An answer still streaming was last saved when it started, with no text. When the page
  // is hidden or goes away, what's shown so far is saved too, so it reopens as stopped with
  // that text instead of "stopped before the first token".
  useEffect(() => {
    // Switching tabs: the page stays alive, so history can be written now.
    const onHide = () => {
      if (document.visibilityState !== 'hidden') return
      flush()
      for (const c of [chatRef.current, ...backgroundRef.current]) if (isChatBusy(c)) put(c)
    }
    // Reload or close: IndexedDB writes started now are dropped, so what's owed waits in
    // localStorage, written synchronously, until the next load saves it.
    const onPageHide = () => {
      const owed = new Map<string, ChatState>()
      if (pending.current) owed.set(pending.current.id, pending.current)
      for (const c of [chatRef.current, ...backgroundRef.current]) if (isChatBusy(c)) owed.set(c.id, c)
      stashUnsaved([...owed.values()].map((c) => toStored(c, Date.now())))
    }
    document.addEventListener('visibilitychange', onHide)
    window.addEventListener('pagehide', onPageHide)
    return () => {
      document.removeEventListener('visibilitychange', onHide)
      window.removeEventListener('pagehide', onPageHide)
      flush()
    }
  }, [flush, put])

  // ── Reopening after a reload ──────────────────────────────────────────────
  useEffect(() => writeSession(OPEN_CHAT_KEY, chat.id), [chat.id])

  useEffect(() => {
    if (!restoreId) return
    let cancelled = false
    recoverUnsaved(store)
      .then(() => store.get(restoreId))
      .then((saved) => {
        if (!cancelled && saved) callbacks.current.onOpen(fromStored(saved))
      })
      .catch(() => undefined)
      .finally(() => {
        if (!cancelled) setRestoring(false)
      })
    return () => {
      cancelled = true
    }
  }, [restoreId, store])

  // ── The list and its actions ──────────────────────────────────────────────
  const refresh = useCallback(() => {
    recoverUnsaved(store)
      .then(() => store.list())
      .then(setChats, () => {
        setChats([])
        setProblem("History isn't available in this browser (storage may be blocked, or this is a private window), so chats aren't being saved.")
      })
  }, [store])

  const open = useCallback(
    async (id: string) => {
      flush()
      const saved = await store.get(id).catch(() => undefined)
      if (saved) {
        callbacks.current.onOpen(fromStored(saved))
      } else {
        setProblem("That chat couldn't be opened.")
        refresh()
      }
    },
    [flush, refresh, store],
  )

  const remove = useCallback(
    async (id: string) => {
      if (pending.current?.id === id) {
        clearTimeout(timer.current)
        pending.current = null
      }
      try {
        const saved = await store.get(id)
        await store.delete(id)
        setChats((prev) => prev?.filter((c) => c.id !== id))
        setDeleted(saved)
      } catch {
        setProblem("That chat couldn't be deleted.")
        return
      }
      if (id === chatRef.current.id) callbacks.current.onOpenChatDeleted()
    },
    [store],
  )

  /** Puts the last deleted chat back, in its old place. */
  const undo = useCallback(async () => {
    if (!deleted) return
    setDeleted(undefined)
    await store.put(deleted).catch((err: unknown) => setProblem(saveProblem(err)))
    refresh()
  }, [deleted, refresh, store])

  const clearAll = useCallback(async () => {
    clearTimeout(timer.current)
    pending.current = null
    try {
      await store.clear()
    } catch {
      setProblem("History couldn't be cleared.")
      return
    }
    setChats([])
    setDeleted(undefined)
    if (hasMessages(chatRef.current)) callbacks.current.onOpenChatDeleted()
  }, [store])

  return { chats, problem, deleted, restoring, refresh, open, remove, undo, clearAll, saveNow, dismissProblem: () => setProblem(undefined) }
}

function saveProblem(err: unknown): string {
  return err instanceof DOMException && err.name === 'QuotaExceededError'
    ? "Couldn't save this chat: this browser's storage is full. Delete some old chats to make room."
    : "Couldn't save this chat to history."
}

/** Saves still owed when the page went away (see `onPageHide`), waiting for the next load. */
const UNSAVED_KEY = 'playground.unsavedChats'

/** Adds chats to the waiting saves. Another tab may have left some there too. */
function stashUnsaved(chats: StoredChat[]): void {
  if (chats.length === 0) return
  const waiting = new Map(readUnsaved().map((c) => [c.id, c]))
  for (const c of chats) waiting.set(c.id, c)
  writeStorage(UNSAVED_KEY, JSON.stringify([...waiting.values()]))
}

function readUnsaved(): StoredChat[] {
  try {
    const parsed: unknown = JSON.parse(readStorage(UNSAVED_KEY) ?? '[]')
    return Array.isArray(parsed) ? parsed.map(readStoredChat).filter((c): c is StoredChat => c !== undefined) : []
  } catch {
    return []
  }
}

/** One recovery per store per page load, however often the hook mounts (StrictMode mounts twice). */
const recoveries = new WeakMap<ChatStore, Promise<void>>()

/**
 * Moves the waiting saves into history, unless history already holds a newer copy. Runs
 * before history is first read, so a reload reopens the chat with its text.
 */
function recoverUnsaved(store: ChatStore): Promise<void> {
  let recovery = recoveries.get(store)
  if (!recovery) {
    const waiting = readUnsaved()
    removeStorage(UNSAVED_KEY)
    recovery = (async () => {
      for (const chat of waiting) {
        const saved = await store.get(chat.id).catch(() => undefined)
        if (!saved || saved.updatedAt <= chat.updatedAt) await store.put(chat).catch(() => undefined)
      }
    })()
    recoveries.set(store, recovery)
  }
  return recovery
}

// Session storage can throw (blocked storage). Not reopening the chat after a reload is fine.
function readSession(key: string): string | null {
  try {
    return sessionStorage.getItem(key)
  } catch {
    return null
  }
}

function writeSession(key: string, value: string): void {
  try {
    sessionStorage.setItem(key, value)
  } catch {
    // ignore
  }
}
