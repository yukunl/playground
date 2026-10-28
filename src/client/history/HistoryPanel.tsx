import { Plus, Trash2, X } from 'lucide-react'
import { useState } from 'react'
import { relativeTime } from '../format'
import type { ChatSummary, StoredChat } from './stored-chat'

type Props = {
  /** Undefined while loading. */
  chats: ChatSummary[] | undefined
  openChatId: string
  problem?: string
  /** The last deleted chat, while it can still be put back. */
  deleted?: StoredChat
  /** Chats with an answer still streaming, open or finishing in the background. */
  generating: ReadonlySet<string>
  nameOf: (modelId: string) => string
  onOpen: (id: string) => void
  onDelete: (id: string) => void
  onUndo: () => void
  onClearAll: () => void
  onNewChat: () => void
  /** False while the open chat is still empty: a new chat would look the same. */
  canStartNew: boolean
  /** The drawer on narrow screens has its own ✕; the sidebar on wide ones is toggled from the header. */
  onClose?: () => void
  onDismissProblem: () => void
}

/**
 * The left sidebar (design §10): New chat on top, then History, the saved chats, newest
 * first, in this browser only. A sidebar on wide screens, a drawer on narrow ones.
 */
export function HistoryPanel({ chats, openChatId, problem, deleted, generating, nameOf, onOpen, onDelete, onUndo, onClearAll, onNewChat, canStartNew, onClose, onDismissProblem }: Props) {
  const [confirmingClear, setConfirmingClear] = useState(false)
  const now = Date.now()

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 px-3 pt-3">
        <button
          type="button"
          onClick={onNewChat}
          disabled={!canStartNew}
          title={canStartNew ? 'New chat (⌘⇧O)' : 'This chat is new already'}
          className="flex flex-1 items-center gap-1.5 rounded-md border border-slate-300 px-2.5 py-1.5 text-sm font-medium hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-brand-500 disabled:cursor-default disabled:opacity-50 disabled:hover:bg-transparent dark:border-slate-700 dark:hover:bg-slate-900"
        >
          <Plus aria-hidden className="size-4" /> New chat
        </button>
        {onClose && (
          <button type="button" onClick={onClose} aria-label="Close history" className={ICON_BUTTON}>
            <X aria-hidden className="size-4" />
          </button>
        )}
      </div>

      <div className="border-b border-slate-200 px-4 pb-3 pt-4 dark:border-slate-800">
        <h2 className="text-sm font-semibold">History</h2>
      </div>

      {problem && (
        <div role="status" className="mx-3 mt-3 flex items-start justify-between gap-2 rounded-md bg-amber-50 px-2.5 py-2 text-xs text-amber-900 dark:bg-amber-950 dark:text-amber-200">
          <p>{problem}</p>
          <button type="button" onClick={onDismissProblem} aria-label="Dismiss" className="shrink-0 rounded p-0.5 hover:bg-amber-100 dark:hover:bg-amber-900">
            <X aria-hidden className="size-3.5" />
          </button>
        </div>
      )}

      {deleted && (
        <div role="status" className="mx-3 mt-3 flex items-center justify-between gap-2 rounded-md bg-slate-100 px-2.5 py-1.5 text-xs dark:bg-slate-800/70">
          <p className="min-w-0 truncate">Deleted “{deleted.title}”</p>
          <button type="button" onClick={onUndo} className="shrink-0 font-medium underline underline-offset-2 hover:no-underline">
            Undo
          </button>
        </div>
      )}

      <nav aria-label="Saved chats" className="min-h-0 flex-1 overflow-y-auto px-3 py-3">
        {chats === undefined ? (
          <p className="px-1 text-xs text-slate-500">Loading…</p>
        ) : chats.length === 0 ? (
          <p className="px-1 text-xs text-slate-500">No saved chats yet. A chat is saved here once you send a message.</p>
        ) : (
          <ul className="space-y-0.5">
            {chats.map((c) => {
              const current = c.id === openChatId
              return (
                <li key={c.id} className={`group flex items-center rounded-md ${current ? 'bg-slate-100 dark:bg-slate-800/70' : 'hover:bg-slate-50 dark:hover:bg-slate-900'}`}>
                  <button
                    type="button"
                    onClick={() => onOpen(c.id)}
                    aria-current={current ? 'page' : undefined}
                    className="min-w-0 flex-1 rounded-md px-2 py-1.5 text-left focus-visible:outline-2 focus-visible:outline-brand-500"
                  >
                    <span className="block truncate text-sm">{c.title}</span>
                    <span className="mt-0.5 flex min-w-0 items-center gap-2 overflow-hidden text-[11px] text-slate-500">
                      {generating.has(c.id) ? (
                        <span className="flex items-center gap-1.5 text-teal-700 dark:text-teal-400">
                          {/* The one dot: it shows a live state, like the streaming stats line. */}
                          <span aria-hidden className="inline-block size-1.5 animate-pulse rounded-full bg-teal-600 motion-reduce:animate-none dark:bg-teal-500" />
                          Generating…
                        </span>
                      ) : (
                        <span className="shrink-0">{relativeTime(c.updatedAt, now)}</span>
                      )}
                      <span className="min-w-0 truncate">{nameOf(c.model)}</span>
                      {c.compare && <Badge>Compare</Badge>}
                      {c.proposal ? <Badge>Proposal</Badge> : c.sharedFrom && <Badge>Shared</Badge>}
                    </span>
                  </button>
                  <button
                    type="button"
                    onClick={() => onDelete(c.id)}
                    aria-label={`Delete “${c.title}”`}
                    title="Delete"
                    className={`${ICON_BUTTON} mr-1 opacity-0 group-hover:opacity-100 focus-visible:opacity-100`}
                  >
                    <Trash2 aria-hidden className="size-3.5" />
                  </button>
                </li>
              )
            })}
          </ul>
        )}
      </nav>

      {chats && chats.length > 0 && (
        <div className="border-t border-slate-200 px-4 py-3 text-xs dark:border-slate-800">
          {confirmingClear ? (
            <div className="flex flex-wrap items-center gap-2">
              <span>Delete all {chats.length} chats? This can’t be undone.</span>
              <button
                type="button"
                onClick={() => {
                  setConfirmingClear(false)
                  onClearAll()
                }}
                className="rounded bg-red-600 px-2 py-1 font-medium text-white hover:bg-red-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-500"
              >
                Delete all
              </button>
              <button type="button" onClick={() => setConfirmingClear(false)} className="rounded px-2 py-1 hover:bg-slate-100 dark:hover:bg-slate-800">
                Cancel
              </button>
            </div>
          ) : (
            <button type="button" onClick={() => setConfirmingClear(true)} className="text-slate-500 underline-offset-2 hover:text-red-600 hover:underline">
              Clear all chats
            </button>
          )}
        </div>
      )}
    </div>
  )
}

const ICON_BUTTON =
  'shrink-0 rounded p-1 text-slate-500 hover:bg-slate-200/70 hover:text-slate-900 focus-visible:outline-2 focus-visible:outline-brand-500 dark:hover:bg-slate-700 dark:hover:text-slate-100'

function Badge({ children }: { children: string }) {
  return <span className="shrink-0 rounded bg-slate-200/70 px-1 text-[11px] text-slate-600 dark:bg-slate-700 dark:text-slate-300">{children}</span>
}
