import { ChevronLeft, ChevronRight } from 'lucide-react'
import { useEffect, useRef, type RefObject } from 'react'

/**
 * Hides or shows history from the sidebar's edge: a round ‹ on its border while it's open, a ›
 * tab on the window's left edge while it's folded (or, below 1024 px, to open the drawer).
 */
export function HistoryHandle({ open, onClick, takeFocus }: { open: boolean; onClick: () => void; takeFocus: RefObject<boolean> }) {
  const label = open ? 'Hide history' : 'Show history'
  const button = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    if (!takeFocus.current) return
    takeFocus.current = false
    button.current?.focus()
  }, [takeFocus])
  return (
    <button
      ref={button}
      type="button"
      onClick={onClick}
      aria-label={label}
      aria-expanded={open}
      title={label}
      className={`absolute top-1/2 z-10 flex -translate-y-1/2 items-center justify-center border border-slate-300 bg-white text-slate-500 hover:bg-slate-100 hover:text-slate-900 focus-visible:outline-2 focus-visible:outline-brand-500 dark:border-slate-700 dark:bg-slate-950 dark:hover:bg-slate-800 dark:hover:text-slate-100 ${
        open ? '-right-3 size-6 rounded-full' : 'left-0 h-10 w-5 rounded-r-md border-l-0'
      }`}
    >
      {open ? <ChevronLeft aria-hidden className="size-3.5" /> : <ChevronRight aria-hidden className="size-3.5" />}
    </button>
  )
}
