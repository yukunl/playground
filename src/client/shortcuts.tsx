import { useEffect, useRef } from 'react'
import { Dialog } from './ui/dialog'

export const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform)
const MOD = isMac ? '⌘' : 'Ctrl+'

export const SHORTCUTS = [
  { keys: `${MOD}↵`, does: 'Run' },
  { keys: `${MOD}⇧↵`, does: 'Run the last message again (replaces its answer; in compare, the focused column)' },
  { keys: 'Esc', does: 'Stop while streaming (both columns in compare); otherwise close what is open' },
  { keys: `${MOD}K`, does: 'Switch model' },
  { keys: `${MOD}⇧O`, does: 'New chat' },
  { keys: `${MOD}/`, does: 'Show these shortcuts' },
]

type Actions = {
  runAgain: () => void
  stop: () => void
  openModelPicker: () => void
  newChat: () => void
  showShortcuts: () => void
  isStreaming: boolean
}

/**
 * The page-wide shortcuts. ⌘↵ lives in the input box itself. Browser shortcuts
 * (⌘R, ⌘W, ⌘L, ⌘F, ⌘⇧C) are never taken over.
 */
export function useShortcuts(actions: Actions) {
  const latest = useRef(actions)
  latest.current = actions

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const a = latest.current
      const mod = isMac ? e.metaKey : e.ctrlKey
      const key = e.key.toLowerCase()

      if (mod && e.shiftKey && e.key === 'Enter') {
        e.preventDefault()
        a.runAgain()
      } else if (mod && !e.shiftKey && key === 'k') {
        e.preventDefault()
        a.openModelPicker()
      } else if (mod && e.shiftKey && key === 'o') {
        e.preventDefault()
        a.newChat()
      } else if (mod && (e.key === '/' || e.key === '?')) {
        e.preventDefault()
        a.showShortcuts()
      } else if (e.key === 'Escape' && a.isStreaming && !insideOverlay(e.target)) {
        // Esc in an open picker or dialog closes it; it shouldn't also stop the answer.
        a.stop()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
}

function insideOverlay(target: EventTarget | null): boolean {
  return target instanceof Element && Boolean(target.closest('[role="dialog"], [data-radix-popper-content-wrapper]'))
}

export function ShortcutsDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange} title="Keyboard shortcuts">
      <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-2 text-sm">
        {SHORTCUTS.map((s) => (
          <div key={s.keys} className="contents">
            <dt>
              <kbd className="rounded border border-slate-300 px-1.5 py-0.5 font-mono text-xs dark:border-slate-700">{s.keys}</kbd>
            </dt>
            <dd className="text-slate-600 dark:text-slate-400">{s.does}</dd>
          </div>
        ))}
      </dl>
      <p className="mt-4 text-xs text-slate-500">Enter adds a new line, because playground prompts are often multi-line.</p>
    </Dialog>
  )
}
