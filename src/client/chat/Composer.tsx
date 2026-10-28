import { useEffect, useRef, type KeyboardEvent, type ReactNode } from 'react'
import { isMac } from '../shortcuts'

type Props = {
  value: string
  onChange: (value: string) => void
  onRun: () => void
  onStop: () => void
  streaming: boolean
  canRun: boolean
  /** Why Run is disabled, when it's not just an empty box. */
  blockedReason?: string
  placeholder?: string
  /** Under the text, on the left: the mode selector and model chips, like Arena. */
  toolbar?: ReactNode
  /** Under the text, just before Run: the Settings toggle. */
  trailing?: ReactNode
}

const RUN_KEY = isMac ? '⌘↵' : 'Ctrl+↵'

/**
 * ⌘↵ runs; Enter is a new line, because playground prompts are often multi-line.
 * You can keep drafting while an answer streams; Run turns into Stop in the same place.
 */
export function Composer({ value, onChange, onRun, onStop, streaming, canRun, blockedReason, placeholder = 'Paste your prompt…', toolbar, trailing }: Props) {
  const textarea = useRef<HTMLTextAreaElement>(null)

  // Focused on load, so you can paste and run without touching the mouse.
  useEffect(() => textarea.current?.focus(), [])

  // Grow with the text, up to a limit.
  useEffect(() => {
    const el = textarea.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, 240)}px`
  }, [value])

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    // ⌘⇧↵ (run again) is handled page-wide.
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && !e.shiftKey) {
      e.preventDefault()
      if (!streaming && canRun) onRun()
    }
  }

  const stop = () => {
    onStop()
    textarea.current?.focus()
  }

  return (
    <div className="rounded-lg border border-slate-400 bg-white p-2 focus-within:outline-2 focus-within:-outline-offset-1 focus-within:outline-brand-500 dark:border-slate-600 dark:bg-slate-900">
      <textarea
        ref={textarea}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={onKeyDown}
        rows={1}
        placeholder={placeholder}
        aria-label="Message"
        className="max-h-60 min-h-9 w-full resize-none bg-transparent px-2 py-1.5 text-sm outline-none placeholder:text-slate-400"
      />
      {/* The toolbar's items and the Run group wrap as one row, so a phone takes two rows, not one per chip. */}
      <div className="mt-1 flex flex-wrap items-center gap-1.5">
        {toolbar}
        <div className="ml-auto flex shrink-0 items-center gap-1.5">
          {trailing}
          {streaming ? (
            <button
              type="button"
              onClick={stop}
              title="Stop (Esc)"
              className="shrink-0 rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-900 hover:bg-slate-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-500 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 dark:hover:bg-slate-800"
            >
              ■ Stop
            </button>
          ) : (
            <button
              type="button"
              onClick={onRun}
              disabled={!canRun}
              title={blockedReason ?? `Run (${RUN_KEY})`}
              className="shrink-0 rounded-md bg-slate-950 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-500 disabled:cursor-not-allowed disabled:opacity-40 dark:bg-slate-200 dark:text-slate-950 dark:hover:bg-white"
            >
              Run <span className="ml-1 text-xs opacity-75">{RUN_KEY}</span>
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
