import { Square } from 'lucide-react'
import type { ReactNode } from 'react'
import type { RunActions } from '../errors/ErrorCard'
import { ChatView } from './ChatView'
import type { Difference } from './differences'
import type { Column } from './types'
import { useStickToBottom } from './use-stick-to-bottom'

type Props = {
  column: Column
  /** `actions.runAgain` is only passed when this column can run again. */
  actions: RunActions
  canRunAgain: boolean
  nameOf: (modelId: string) => string
  /** Above the messages: notices. */
  top?: ReactNode
  /** Instead of the messages, when there are none. */
  empty?: ReactNode
}

/**
 * One conversation, scrolling on its own: the whole chat normally, one of two
 * columns in compare. It follows new text only while you're at the bottom.
 */
export function ColumnView({ column, actions, canRunAgain, nameOf, top, empty }: Props) {
  const last = column.messages.at(-1)
  const { ref, onScroll, stuck, jumpToLatest } = useStickToBottom<HTMLDivElement>(last ? last.text.length + column.messages.length : 0)

  return (
    <div className="relative min-h-0 flex-1">
      <div ref={ref} onScroll={onScroll} className="h-full overflow-y-auto" aria-live="polite">
        <div className="mx-auto max-w-3xl px-4 py-6">
          {top}
          {column.messages.length === 0 ? empty : <ChatView messages={column.messages} actions={actions} canRunAgain={canRunAgain} nameOf={nameOf} />}
        </div>
      </div>
      {!stuck && (
        <button
          type="button"
          onClick={jumpToLatest}
          className="absolute bottom-3 left-1/2 -translate-x-1/2 rounded-full border border-slate-300 bg-white px-3 py-1 text-xs shadow-sm hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:hover:bg-slate-800"
        >
          ↓ Jump to latest
        </button>
      )}
    </div>
  )
}

type HeaderProps = {
  label: 'A' | 'B'
  modelName: string
  /** This panel's own values for the settings A and B differ in, one per line under the model. */
  differences: Difference[]
  /** The panel that ⌘K and ⌘⇧↵ act on. */
  focused: boolean
  streaming: boolean
  /** One of an agent's proposed choices: its name, and what's been changed since. */
  choice?: { label: string; changed: string[] }
  /** This panel's usage so far, from `formatUsage`; empty to leave it out. */
  usage: string[]
  onStop: () => void
}

/**
 * A panel's header in Compare (design §9): A or B, its model, what it has used, and Stop; under
 * them, its own values for the settings A and B differ in, so each side's setup sits above its own
 * answers. Models are picked, and the mode changed, in the prompt box.
 */
export function ColumnHeader({ label, modelName, differences, focused, streaming, choice, usage, onStop }: HeaderProps) {
  return (
    <div className={`border-b-2 px-4 py-1.5 text-xs ${focused ? 'border-brand-500' : 'border-slate-200 dark:border-slate-800'}`}>
      <div className="flex items-center justify-between gap-2">
        <p className="min-w-0 truncate">
          <span className={`mr-1.5 inline-block w-4 rounded text-center font-semibold ${focused ? 'bg-brand-500 text-white' : 'bg-slate-200 dark:bg-slate-700'}`}>{label}</span>
          {choice && (
            <span className="mr-2">
              <span className="font-medium">{choice.label}</span>
              {choice.changed.length > 0 && (
                <span className="text-amber-700 dark:text-amber-400" title={`Changed since it was proposed: ${choice.changed.join(', ')}`}>
                  {' '}
                  (edited)
                </span>
              )}
            </span>
          )}
          <span className="font-medium">{modelName}</span>
        </p>
        <div className="flex shrink-0 items-center gap-0.5">
          {usage.length > 0 && (
            <span className="mr-1.5 flex gap-x-2 font-mono tabular-nums text-slate-500" title="This panel so far">
              {usage.map((part) => (
                <span key={part}>{part}</span>
              ))}
            </span>
          )}
          {streaming && (
            <button
              type="button"
              onClick={onStop}
              title={`Stop ${label}`}
              className="flex items-center gap-1 rounded px-1.5 py-1 text-slate-500 hover:bg-slate-100 hover:text-slate-900 focus-visible:outline-2 focus-visible:outline-brand-500 dark:hover:bg-slate-800 dark:hover:text-slate-100"
            >
              <Square aria-hidden className="size-3 fill-current" /> Stop
            </button>
          )}
        </div>
      </div>
      {/* One line per setting, cut off rather than wrapped: both panels list the same settings, so their headers stay the same height. */}
      {differences.length > 0 && (
        <ul className="mt-0.5 pl-[1.375rem]">
          {differences.map((d) => (
            <li key={d.name} className="truncate" title={d.title}>
              <span className="text-slate-500">{d.name}</span> {d.value}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
