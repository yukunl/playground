import type { ApiError } from '../../shared/api-error'
import { DEFAULT_SETTINGS, type ChatMessage, type Settings } from '../../shared/chat'
import type { Usage } from '../../shared/stream-events'
import { newId } from '../ids'
import type { AssistantMessage, ChatState, Column, Message } from './types'

export type ChatAction =
  | { type: 'attemptStarted'; runId: string; requestId: string; number: number; at: number }
  | { type: 'attemptFailed'; runId: string; requestId: string; error: ApiError; at: number }
  /** Waiting before the next attempt: `until` is when it starts, or null until the connection is back. */
  | { type: 'retrying'; runId: string; error: ApiError; retry: number; until: number | null; waitedMs?: number }
  | { type: 'send'; columnId: string; text: string; runId: string; requestId: string; at: number }
  /** Run the last message again: its answer is replaced by a new one made with `settings`. */
  | { type: 'rerun'; columnId: string; runId: string; requestId: string; settings: Settings; at: number }
  | { type: 'updateSettings'; columnId: string; patch: Partial<Settings> }
  | { type: 'resetSettings'; columnId: string }
  /**
   * Starts a new chat with a new ID; every column's settings carry over. An answer
   * still streaming finishes in the background, unless `discard` (the chat was deleted).
   */
  | { type: 'newChat'; id: string; at: number; discard?: true }
  /** Compare: adds a second column (a copy of the first, or one put back by Undo at `index`). */
  | { type: 'addColumn'; column: Column }
  /** Closes one of the two columns. */
  | { type: 'removeColumn'; columnId: string }
  /** Opens a saved chat, or one from a share link. */
  | { type: 'load'; chat: ChatState }
  /** Forgets an agent's proposal: the banner and the choice labels go, the settings stay. */
  | { type: 'clearProposal' }
  | { type: 'tokens'; runId: string; text: string; at: number; firstTokenAt?: number; receivedChars?: number }
  | { type: 'done'; runId: string; finishReason: 'stop' | 'length'; usage?: Usage; costUsd: number | null; at: number }
  | { type: 'failed'; runId: string; error: ApiError; at: number }
  | { type: 'interrupted'; runId: string; error: ApiError; at: number }
  | { type: 'cancelled'; runId: string; at: number }
  | { type: 'setModel'; columnId: string; model: string }

export function initialChat(id = newId('chat'), at = Date.now()): ChatState {
  return { id, createdAt: at, rev: 0, columns: [{ id: 'col_a', settings: { ...DEFAULT_SETTINGS, model: '' }, messages: [] }] }
}

/**
 * Changes worth saving to history. Tokens and retry bookkeeping aren't: a run is
 * saved when it starts and when it ends, never per token.
 */
const SAVED = new Set<ChatAction['type']>([
  'send', 'rerun', 'done', 'failed', 'interrupted', 'cancelled', 'updateSettings', 'resetSettings', 'setModel', 'addColumn', 'removeColumn', 'clearProposal',
])

export function chatReducer(state: ChatState, action: ChatAction): ChatState {
  const next = apply(state, action)
  return SAVED.has(action.type) && next !== state ? { ...next, rev: next.rev + 1 } : next
}

function apply(state: ChatState, action: ChatAction): ChatState {
  switch (action.type) {
    case 'send':
      return updateColumn(state, action.columnId, (col) => ({
        ...col,
        messages: [
          ...col.messages,
          { role: 'user', text: action.text },
          {
            role: 'assistant',
            runId: action.runId,
            requestId: action.requestId,
            text: '',
            status: 'streaming',
            settingsUsed: col.settings,
            startedAt: action.at,
            attempts: [],
          },
        ],
      }))

    case 'attemptStarted':
      return updateRun(state, action.runId, (m) => ({
        ...m,
        requestId: action.requestId,
        attempts: [...m.attempts, { number: action.number, requestId: action.requestId, startedAt: action.at }],
        retrying: undefined,
      }))

    case 'attemptFailed':
      return updateRun(state, action.runId, (m) => ({
        ...m,
        attempts: m.attempts.map((a) =>
          a.requestId === action.requestId
            ? { ...a, durationMs: action.at - a.startedAt, errorType: action.error.type, ...(action.error.status ? { status: action.error.status } : {}) }
            : a,
        ),
      }))

    case 'retrying':
      return updateRun(state, action.runId, (m) => ({
        ...m,
        retrying: { until: action.until, retry: action.retry, error: action.error },
        attempts:
          action.waitedMs === undefined
            ? m.attempts
            : m.attempts.map((a, i) => (i === m.attempts.length - 1 ? { ...a, waitedMs: action.waitedMs } : a)),
      }))

    case 'tokens':
      return updateRun(state, action.runId, (m) => ({
        ...m,
        text: m.text + action.text,
        firstTokenAt: m.firstTokenAt ?? action.firstTokenAt ?? action.at,
        receivedAt: action.at,
        receivedChars: action.receivedChars ?? m.text.length + action.text.length,
      }))

    case 'done':
      return updateRun(state, action.runId, (m) => ({
        ...m,
        status: 'done',
        finishReason: action.finishReason,
        ...(action.usage ? { usage: action.usage } : {}),
        costUsd: action.costUsd,
        finishedAt: action.at,
      }))

    case 'failed':
    case 'interrupted':
      return updateRun(state, action.runId, (m) => ({
        ...m,
        status: action.type,
        error: action.error,
        finishedAt: action.at,
        retrying: undefined,
      }))

    case 'cancelled':
      return updateRun(state, action.runId, (m) => ({ ...m, status: 'cancelled', finishedAt: action.at, retrying: undefined }))

    case 'setModel':
      return updateColumn(state, action.columnId, (col) => ({ ...col, settings: { ...col.settings, model: action.model } }))

    case 'rerun':
      return updateColumn(state, action.columnId, (col) => {
        const fresh: AssistantMessage = {
          role: 'assistant',
          runId: action.runId,
          requestId: action.requestId,
          text: '',
          status: 'streaming',
          settingsUsed: action.settings,
          startedAt: action.at,
          attempts: [],
        }
        const last = col.messages.at(-1)
        return {
          ...col,
          messages: last?.role === 'assistant' ? [...col.messages.slice(0, -1), fresh] : [...col.messages, fresh],
        }
      })

    case 'updateSettings':
      return updateColumn(state, action.columnId, (col) => ({ ...col, settings: { ...col.settings, ...action.patch } }))

    case 'resetSettings':
      return updateColumn(state, action.columnId, (col) => ({ ...col, settings: { ...DEFAULT_SETTINGS, model: col.settings.model } }))

    case 'newChat':
      // The mode carries over: Compare stays Compare, with both setups, so the same
      // comparison can take another prompt. So does a proposal, with its choices.
      return {
        id: action.id,
        createdAt: action.at,
        rev: 0,
        columns: state.columns.map((col) => ({ ...col, messages: [] })),
        ...(state.proposal ? { proposal: state.proposal } : {}),
      }

    case 'addColumn': {
      if (state.columns.length >= 2) return state
      return { ...state, columns: [...state.columns, action.column] }
    }

    case 'removeColumn':
      return state.columns.length < 2 ? state : { ...state, columns: state.columns.filter((col) => col.id !== action.columnId) }

    case 'load':
      return action.chat

    case 'clearProposal': {
      if (!state.proposal) return state
      const { proposal: _, ...rest } = state
      return { ...rest, columns: state.columns.map(({ proposed: __, ...col }) => col) }
    }
  }
}

/**
 * The open chat, plus chats you left while an answer was still streaming. Those keep
 * receiving their run's events until it ends, then are saved and released.
 */
export type Workspace = { chat: ChatState; background: ChatState[] }

export type WorkspaceAction =
  | ChatAction
  /** Opens a chat that's still finishing in the background, live. */
  | { type: 'resume'; id: string }
  /** Forgets a background chat: its finished copy is saved, or it was deleted. */
  | { type: 'release'; id: string }

/** Events from a run in progress. They go to whichever chat the run belongs to. */
const RUN_EVENTS = new Set<WorkspaceAction['type']>(['attemptStarted', 'attemptFailed', 'retrying', 'tokens', 'done', 'failed', 'interrupted', 'cancelled'])

export function initialWorkspace(): Workspace {
  return { chat: initialChat(), background: [] }
}

export function workspaceReducer(ws: Workspace, action: WorkspaceAction): Workspace {
  switch (action.type) {
    case 'newChat':
      return { chat: chatReducer(ws.chat, action), background: action.discard ? ws.background : keepIfBusy(ws.chat, ws.background) }

    case 'load': {
      // Reopening the chat that's already open keeps its live answer.
      if (action.chat.id === ws.chat.id) return isChatBusy(ws.chat) ? ws : { ...ws, chat: action.chat }
      // A saved copy of a chat still finishing in the background is out of date: use the live one.
      const live = ws.background.find((c) => c.id === action.chat.id)
      const rest = ws.background.filter((c) => c.id !== action.chat.id)
      return { chat: live ?? action.chat, background: keepIfBusy(ws.chat, rest) }
    }

    case 'resume': {
      const live = ws.background.find((c) => c.id === action.id)
      if (!live) return ws
      return { chat: live, background: keepIfBusy(ws.chat, ws.background.filter((c) => c.id !== action.id)) }
    }

    case 'release':
      return { ...ws, background: ws.background.filter((c) => c.id !== action.id) }

    default: {
      if (RUN_EVENTS.has(action.type) && 'runId' in action) {
        const i = ws.background.findIndex((c) => holdsRun(c, action.runId))
        if (i >= 0) return { ...ws, background: ws.background.map((c, j) => (j === i ? chatReducer(c, action) : c)) }
      }
      const chat = chatReducer(ws.chat, action)
      return chat === ws.chat ? ws : { ...ws, chat }
    }
  }
}

export function isBusy(col: Column): boolean {
  return col.messages.some((m) => m.role === 'assistant' && m.status === 'streaming')
}

export function isChatBusy(chat: ChatState): boolean {
  return chat.columns.some(isBusy)
}

/** A chat you leave mid-answer goes to the background; one with nothing streaming is simply left. */
function keepIfBusy(chat: ChatState, background: ChatState[]): ChatState[] {
  return isChatBusy(chat) ? [chat, ...background.filter((c) => c.id !== chat.id)] : background
}

function holdsRun(chat: ChatState, runId: string): boolean {
  return chat.columns.some((col) => col.messages.some((m) => m.role === 'assistant' && m.runId === runId))
}

function updateColumn(state: ChatState, columnId: string, fn: (col: Column) => Column): ChatState {
  return { ...state, columns: state.columns.map((col) => (col.id === columnId ? fn(col) : col)) }
}

/** Only a run that's still streaming can change: late events for a stopped run are ignored. */
function updateRun(state: ChatState, runId: string, fn: (m: AssistantMessage) => AssistantMessage): ChatState {
  return {
    ...state,
    columns: state.columns.map((col) => ({
      ...col,
      messages: col.messages.map((m) => (m.role === 'assistant' && m.runId === runId && m.status === 'streaming' ? fn(m) : m)),
    })),
  }
}

/** Compare starts from a copy of A: same settings, same history, so B differs only in what you change. */
export function duplicateColumn(col: Column, id: string): Column {
  return { id, settings: { ...col.settings }, messages: col.messages.map(stopped) }
}

/** An ID for a new column: after closing A, the one left may be col_b, so the new one is col_a. */
export function freeColumnId(columns: Column[]): string {
  return columns.some((col) => col.id === 'col_b') ? 'col_a' : 'col_b'
}

/**
 * A column whose runs can no longer get events (the page reloaded) shows them as
 * stopped, with whatever text had arrived.
 */
export function stopStreaming(col: Column): Column {
  return { ...col, messages: col.messages.map(stopped) }
}

function stopped(m: Message): Message {
  if (m.role !== 'assistant' || m.status !== 'streaming') return m
  const { retrying: _, ...rest } = m
  return { ...rest, status: 'cancelled', finishedAt: m.receivedAt ?? m.startedAt }
}

/**
 * The conversation to send for the next message: every user message, plus each
 * answer that produced text. A failed run contributes nothing.
 */
export function historyFor(col: Column): ChatMessage[] {
  return col.messages.flatMap<ChatMessage>((m) =>
    m.role === 'user'
      ? [{ role: 'user', content: m.text }]
      : m.text && m.status !== 'streaming'
        ? [{ role: 'assistant', content: m.text }]
        : [],
  )
}
