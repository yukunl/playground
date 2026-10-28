import type { ReactNode } from 'react'
import { isBusy } from './reducer'
import type { Column } from './types'

type Props = {
  columns: Column[]
  focusedId: string
  /** Clicking or tabbing into a panel focuses it: ⌘K and ⌘⇧↵ act on the focused panel. */
  onFocus: (columnId: string) => void
  /** Compare shows A and B next to each other from tablet width up, and as tabs below it. */
  sideBySide: boolean
  /** A tab's name: an agent's name for the choice, else the model. */
  tabName: (col: Column) => string
  /** What one panel shows. */
  children: (col: Column, i: number) => ReactNode
}

/** Compare's names for the panels. */
export const panelLabel = (i: number) => (i === 0 ? 'A' : 'B')

/** The chat's panels: one in Single; A and B in Compare, side by side or as tabs. */
export function ChatPanels({ columns, focusedId, onFocus, sideBySide, tabName, children }: Props) {
  const comparing = columns.length > 1
  const asTabs = comparing && !sideBySide
  return (
    <>
      {asTabs && (
        <div role="tablist" aria-label="Panels" className="flex border-b border-slate-200 text-xs dark:border-slate-800">
          {columns.map((col, i) => (
            <button
              key={col.id}
              type="button"
              role="tab"
              aria-selected={col.id === focusedId}
              onClick={() => onFocus(col.id)}
              className={`flex-1 truncate border-b-2 px-3 py-2 ${col.id === focusedId ? 'border-brand-500 font-medium' : 'border-transparent text-slate-500'}`}
            >
              <span className="mr-1.5 font-semibold">{panelLabel(i)}</span>
              {tabName(col)}
              {isBusy(col) ? ' …' : ''}
            </button>
          ))}
        </div>
      )}
      <div className="flex min-h-0 flex-1">
        {columns.map((col, i) =>
          asTabs && col.id !== focusedId ? null : (
            <section
              key={col.id}
              aria-label={comparing ? `Panel ${panelLabel(i)}` : 'Chat'}
              onPointerDown={() => onFocus(col.id)}
              onFocusCapture={() => onFocus(col.id)}
              className={`flex min-w-0 flex-1 flex-col ${i > 0 && sideBySide ? 'border-l border-slate-200 dark:border-slate-800' : ''}`}
            >
              {children(col, i)}
            </section>
          ),
        )}
      </div>
    </>
  )
}
