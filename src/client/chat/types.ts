// The chat as the browser holds it (docs/design.md §21.1). A chat is columns,
// each a plain linear conversation; phase 2 renders one column, compare adds a second.
import type { ApiError, ErrorType } from '../../shared/api-error'
import type { Settings } from '../../shared/chat'
import type { Usage } from '../../shared/stream-events'

export type RunStatus = 'streaming' | 'done' | 'cancelled' | 'interrupted' | 'failed'

/** One try at an answer. A run has 1 to 4 (the first plus up to 3 retries). */
export type Attempt = {
  number: number
  requestId: string
  startedAt: number
  durationMs?: number
  status?: number
  errorType?: ErrorType
  /** The automatic wait that followed this attempt, before the next one. */
  waitedMs?: number
}

/** Shown while the run waits to retry: a countdown, or "when you're back online". */
export type Retrying = {
  /** When the next attempt starts; null while waiting for the connection to come back. */
  until: number | null
  /** Which retry is coming: 1, 2 or 3. */
  retry: number
  error: ApiError
}

export type UserMessage = { role: 'user'; text: string }

export type AssistantMessage = {
  role: 'assistant'
  runId: string
  requestId: string
  text: string
  status: RunStatus
  /** Frozen when Run was pressed. */
  settingsUsed: Settings
  startedAt: number
  firstTokenAt?: number
  /** Network progress, independent of the paced visible text. */
  receivedAt?: number
  receivedChars?: number
  /** Network completion time, even when display draining finishes later. */
  finishedAt?: number
  finishReason?: 'stop' | 'length'
  usage?: Usage
  costUsd?: number | null
  error?: ApiError
  attempts: Attempt[]
  retrying?: Retrying
}

export type Message = UserMessage | AssistantMessage

export type Column = {
  id: string
  /** Editable; applies to the next message. */
  settings: Settings
  messages: Message[]
  /** This column is one of an agent's proposed choices, with the settings it proposed. */
  proposed?: ProposedChoice
}

/**
 * An agent's proposal, opened from a share link (docs/agent-handoff.md). Everything
 * in it is the agent's claim; the answers come only from running the columns here.
 */
export type Proposal = {
  /** Who proposed it: "Codex", "Claude Code". */
  by: string
  title: string
  summary?: string
}

export type ProposedChoice = {
  label: string
  why?: string
  /** As proposed, so the header can say when they've been changed since. */
  settings: Settings
}

/** The open chat. Saved to history as a `StoredChat` (history/stored-chat.ts). */
export type ChatState = {
  id: string
  createdAt: number
  columns: Column[]
  /** Started from a share link. */
  sharedFrom?: true
  proposal?: Proposal
  /** Bumped by every change worth saving (never by tokens); 0 means there's nothing new to save. */
  rev: number
}
