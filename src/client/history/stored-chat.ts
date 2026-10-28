// A chat as it's saved in IndexedDB (docs/design.md §21.1), and the conversions
// between it and the open chat.
import { z } from 'zod'
import { stopStreaming } from '../chat/reducer'
import type { AssistantMessage, ChatState, Column, Proposal } from '../chat/types'

export const MAX_SAVED_CHATS = 100
const TITLE_CHARS = 60

export type StoredChat = {
  /** The format version: old versions are upgraded when they're read. */
  v: 1
  id: string
  title: string
  createdAt: number
  updatedAt: number
  columns: Column[]
  sharedFrom?: true
  proposal?: Proposal
}

/** One row in the History panel. */
export type ChatSummary = {
  id: string
  title: string
  updatedAt: number
  model: string
  compare: boolean
  sharedFrom: boolean
  /** Opened from an agent's proposal. */
  proposal: boolean
}

// Saved data can be old, from a newer version of the app, or edited by hand, so it's
// checked before use. The check is structural: a setting that's out of range is
// left for the settings panel to flag rather than losing the whole chat.
const SettingsShape = z.looseObject({
  model: z.string(),
  system: z.string(),
  temperature: z.number(),
  topP: z.number(),
  maxTokens: z.number(),
  stop: z.array(z.string()),
})
const MessageShape = z.discriminatedUnion('role', [
  z.object({ role: z.literal('user'), text: z.string() }),
  z.looseObject({
    role: z.literal('assistant'),
    runId: z.string(),
    text: z.string(),
    status: z.enum(['streaming', 'done', 'cancelled', 'interrupted', 'failed']),
    settingsUsed: SettingsShape,
    startedAt: z.number(),
    attempts: z.array(z.looseObject({})),
  }),
])
const ProposedShape = z.object({ label: z.string(), why: z.string().optional(), settings: SettingsShape })
const StoredChatV1 = z.object({
  v: z.literal(1),
  id: z.string().min(1),
  title: z.string(),
  createdAt: z.number(),
  updatedAt: z.number(),
  columns: z.array(z.object({ id: z.string(), settings: SettingsShape, messages: z.array(MessageShape), proposed: ProposedShape.optional() })).min(1),
  sharedFrom: z.literal(true).optional(),
  proposal: z.object({ by: z.string(), title: z.string(), summary: z.string().optional() }).optional(),
})

/** Reads one saved record: a chat, or undefined if it can't be used. */
export function readStoredChat(raw: unknown): StoredChat | undefined {
  // Only v1 exists so far. A v2 would add `if (raw.v === 1) raw = upgradeV1(raw)` here.
  const parsed = StoredChatV1.safeParse(raw)
  return parsed.success ? (parsed.data as StoredChat) : undefined
}

export function toStored(chat: ChatState, now: number): StoredChat {
  return {
    v: 1,
    id: chat.id,
    title: titleOf(chat),
    createdAt: chat.createdAt,
    updatedAt: now,
    columns: chat.columns.map((col) => ({
      ...col,
      // The retry countdown is live state; it means nothing after a reload.
      messages: col.messages.map((m) => (m.role === 'assistant' ? withoutRetrying(m) : m)),
    })),
    ...(chat.sharedFrom ? { sharedFrom: true } : {}),
    ...(chat.proposal ? { proposal: chat.proposal } : {}),
  }
}

/**
 * Opens a saved chat. A run saved while it was streaming was cut off when the
 * page went away, so it opens as stopped, with whatever text had been saved.
 */
export function fromStored(saved: StoredChat): ChatState {
  return {
    id: saved.id,
    createdAt: saved.createdAt,
    rev: 0,
    columns: saved.columns.map(stopStreaming),
    ...(saved.sharedFrom ? { sharedFrom: true } : {}),
    ...(saved.proposal ? { proposal: saved.proposal } : {}),
  }
}

export function summarize(saved: StoredChat): ChatSummary {
  return {
    id: saved.id,
    title: saved.title,
    updatedAt: saved.updatedAt,
    model: saved.columns[0]?.settings.model ?? '',
    compare: saved.columns.length > 1,
    sharedFrom: Boolean(saved.sharedFrom),
    proposal: Boolean(saved.proposal),
  }
}

/** The first line of the first message, shortened. */
export function titleOf(chat: ChatState): string {
  const first = chat.columns[0]?.messages.find((m) => m.role === 'user')
  const line = first?.text.trim().split('\n')[0]?.replace(/\s+/g, ' ') ?? ''
  if (!line) return 'Untitled chat'
  return line.length > TITLE_CHARS ? `${line.slice(0, TITLE_CHARS - 1).trimEnd()}…` : line
}

export function hasMessages(chat: ChatState): boolean {
  return chat.columns.some((col) => col.messages.length > 0)
}

function withoutRetrying(m: AssistantMessage): AssistantMessage {
  const { retrying: _, ...rest } = m
  return rest
}
