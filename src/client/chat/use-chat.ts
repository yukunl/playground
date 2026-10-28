import { useCallback, useEffect, useReducer, useRef } from 'react'
import type { ChatMessage, Settings } from '../../shared/chat'
import type { FaultPlan } from '../debug/weather'
import { newId } from '../ids'
import { duplicateColumn, freeColumnId, historyFor, initialWorkspace, isBusy, workspaceReducer } from './reducer'
import { startRun } from './run-stream'
import type { ChatState, Column } from './types'

export { isBusy }

/**
 * The open chat: its state, plus send, run again, stop, settings, compare and
 * switching chats. A chat has one column, or two in compare; each
 * column is its own conversation with its own settings. Leaving a chat mid-answer
 * doesn't stop it: it finishes in `background`, and the caller saves it.
 * `faultPlan` says how runs should fail on purpose (Weather control, `?_simulate`).
 */
export function useChat(faultPlan: () => FaultPlan = () => ({})) {
  const [workspace, dispatch] = useReducer(workspaceReducer, undefined, initialWorkspace)
  const state = workspace.chat
  const active = useRef(new Map<string, { chatId: string; columnId: string; cancel: () => void }>())
  const stateRef = useRef(state)
  stateRef.current = state
  const planRef = useRef(faultPlan)
  planRef.current = faultPlan

  const isStreaming = state.columns.some(isBusy)

  /** Starts one run in one column of the open chat, and keeps track of it so Stop can cancel it. */
  const launch = useCallback((columnId: string, settings: Settings, messages: ChatMessage[], runId: string, requestId: string) => {
    const plan = planRef.current()
    const run = startRun(
      {
        request: { settings, messages },
        runId,
        requestId,
        ...(plan.simulateFor ? { simulateFor: plan.simulateFor } : {}),
        ...(plan.fault ? { fault: plan.fault } : {}),
      },
      (action) => {
        if (action.type === 'done' || action.type === 'failed' || action.type === 'interrupted' || action.type === 'cancelled') {
          active.current.delete(runId)
        }
        dispatch(action)
      },
    )
    active.current.set(runId, { chatId: stateRef.current.id, columnId, cancel: run.cancel })
  }, [])

  /** ⌘↵: sends the message to every column at once, each with its own settings and history. */
  const send = useCallback(
    (text: string) => {
      const { columns } = stateRef.current
      const trimmed = text.trim()
      if (!trimmed || columns.some((col) => !col.settings.model || isBusy(col))) return
      for (const col of columns) {
        const runId = newId('run')
        const requestId = newId('req')
        dispatch({ type: 'send', columnId: col.id, text: trimmed, runId, requestId, at: Date.now() })
        launch(col.id, col.settings, [...historyFor(col), { role: 'user', content: trimmed }], runId, requestId)
      }
    },
    [launch],
  )

  /**
   * ⌘⇧↵: runs one column's last message again with its current settings (plus any
   * overrides), replacing its answer. The other column is left alone.
   */
  const runAgain = useCallback(
    (columnId: string, overrides?: Partial<Settings>) => {
      const col = stateRef.current.columns.find((c) => c.id === columnId)
      const lastUser = col?.messages.findLastIndex((m) => m.role === 'user') ?? -1
      const userMessage = col?.messages[lastUser]
      if (!col || !userMessage || userMessage.role !== 'user' || isBusy(col)) return

      const settings = { ...col.settings, ...overrides }
      if (overrides) dispatch({ type: 'updateSettings', columnId, patch: overrides })
      const runId = newId('run')
      const requestId = newId('req')
      dispatch({ type: 'rerun', columnId, runId, requestId, settings, at: Date.now() })
      const before = historyFor({ ...col, messages: col.messages.slice(0, lastUser) })
      launch(columnId, settings, [...before, { role: 'user', content: userMessage.text }], runId, requestId)
    },
    [launch],
  )

  /** Stops one column's run in the open chat, or all of the open chat's runs when no column is given (Esc). */
  const stop = useCallback((columnId?: string) => {
    for (const run of active.current.values()) {
      if (run.chatId === stateRef.current.id && (!columnId || run.columnId === columnId)) run.cancel()
    }
  }, [])

  const updateSettings = useCallback((columnId: string, patch: Partial<Settings>) => {
    dispatch({ type: 'updateSettings', columnId, patch })
  }, [])

  const resetSettings = useCallback((columnId: string) => {
    dispatch({ type: 'resetSettings', columnId })
  }, [])

  /** + Add chat: the second column starts as a copy of the first. Not while an answer is streaming. */
  const startCompare = useCallback(() => {
    const { columns } = stateRef.current
    if (columns.length > 1 || columns.some(isBusy)) return
    dispatch({ type: 'addColumn', column: duplicateColumn(columns[0]!, freeColumnId(columns)) })
  }, [])

  /** Back to one column (Single): stops that column's run, if any, and removes it. */
  const closeColumn = useCallback(
    (columnId: string) => {
      const { columns } = stateRef.current
      if (columns.length < 2 || !columns.some((col) => col.id === columnId)) return
      stop(columnId)
      dispatch({ type: 'removeColumn', columnId })
    },
    [stop],
  )

  /**
   * A fresh chat with the same settings. An answer still streaming keeps going in the
   * background, unless `discard` says the chat is being deleted, which stops it.
   */
  const newChat = useCallback(
    (options: { discard?: boolean } = {}) => {
      if (options.discard) stop()
      dispatch({ type: 'newChat', id: newId('chat'), at: Date.now(), ...(options.discard ? { discard: true as const } : {}) })
    },
    [stop],
  )

  /** Opens another chat (from history or a share link). One still finishing in the background opens live. */
  const load = useCallback((chat: ChatState) => {
    dispatch({ type: 'load', chat })
  }, [])

  /** Opens a chat that's still finishing in the background. */
  const resume = useCallback((id: string) => {
    dispatch({ type: 'resume', id })
  }, [])

  /** Forgets a background chat once it's saved. With `stopRuns`, it was deleted: its runs stop first. */
  const release = useCallback((id: string, options: { stopRuns?: boolean } = {}) => {
    if (options.stopRuns) for (const run of active.current.values()) if (run.chatId === id) run.cancel()
    dispatch({ type: 'release', id })
  }, [])

  const clearProposal = useCallback(() => dispatch({ type: 'clearProposal' }), [])

  // Leaving the page stops everything in flight, background chats included, so the upstream stops generating too.
  useEffect(
    () => () => {
      for (const run of active.current.values()) run.cancel()
    },
    [],
  )

  return {
    state,
    background: workspace.background,
    isStreaming,
    send,
    runAgain,
    stop,
    updateSettings,
    resetSettings,
    startCompare,
    closeColumn,
    newChat,
    load,
    resume,
    release,
    clearProposal,
  }
}
