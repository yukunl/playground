import { clear, createStore, del, get, keys, set, values } from 'idb-keyval'
import { MAX_SAVED_CHATS, readStoredChat, summarize, type ChatSummary, type StoredChat } from './stored-chat'

/** What the chat store needs from storage: IndexedDB in the browser, a Map in tests. */
export type KeyValue = {
  get(key: string): Promise<unknown>
  set(key: string, value: unknown): Promise<void>
  del(key: string): Promise<void>
  keys(): Promise<string[]>
  values(): Promise<unknown[]>
  clear(): Promise<void>
}

/** One IndexedDB database with one object store, keyed by chat ID. */
export function indexedDbBackend(): KeyValue {
  const store = createStore('parasail-playground', 'chats')
  return {
    get: (key) => get(key, store),
    set: (key, value) => set(key, value, store),
    del: (key) => del(key, store),
    keys: () => keys<string>(store),
    values: () => values(store),
    clear: () => clear(store),
  }
}

export function memoryBackend(): KeyValue {
  const map = new Map<string, unknown>()
  return {
    get: async (key) => structuredClone(map.get(key)),
    set: async (key, value) => void map.set(key, structuredClone(value)),
    del: async (key) => void map.delete(key),
    keys: async () => [...map.keys()],
    values: async () => [...map.values()].map((v) => structuredClone(v)),
    clear: async () => map.clear(),
  }
}

/**
 * Saved chats, newest first, capped at the newest `max`. Listing reads every
 * chat, which is fine at 100; a separate summaries index would be the next step.
 */
export function createChatStore(kv: KeyValue, max = MAX_SAVED_CHATS) {
  /** Every chat that can be read, newest first. Unreadable records are skipped, not deleted. */
  async function all(): Promise<StoredChat[]> {
    return (await kv.values())
      .map(readStoredChat)
      .filter((chat): chat is StoredChat => chat !== undefined)
      .sort((a, b) => b.updatedAt - a.updatedAt)
  }

  return {
    async list(): Promise<ChatSummary[]> {
      return (await all()).map(summarize)
    },
    async get(id: string): Promise<StoredChat | undefined> {
      return readStoredChat(await kv.get(id))
    },
    /** Saves a chat, then drops the oldest beyond the newest `max`. */
    async put(chat: StoredChat): Promise<void> {
      await kv.set(chat.id, chat)
      if ((await kv.keys()).length <= max) return
      for (const old of (await all()).slice(max)) await kv.del(old.id)
    },
    delete: (id: string) => kv.del(id),
    clear: () => kv.clear(),
  }
}

export type ChatStore = ReturnType<typeof createChatStore>

let browserStore: ChatStore | undefined

/** The browser's store, created on first use. */
export function defaultChatStore(): ChatStore {
  return (browserStore ??= createChatStore(indexedDbBackend()))
}
