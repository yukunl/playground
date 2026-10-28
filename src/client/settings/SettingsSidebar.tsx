import { X } from 'lucide-react'
import type { ReactNode } from 'react'

type Props = {
  /** Something isn't at its default, on either side. */
  canReset: boolean
  onReset: () => void
  /** ✕: hides the sidebar (or closes the drawer). The Settings button in the prompt box brings it back. */
  onClose: () => void
  /** The `SettingsPanel`. */
  children: ReactNode
}

/** Settings on the right, in Single and Compare alike: a sidebar on wide screens, a drawer on narrow ones. */
export function SettingsSidebar({ canReset, onReset, onClose, children }: Props) {
  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between gap-2 border-b border-slate-200 px-4 py-2 text-xs dark:border-slate-800">
        <h2 className="font-medium text-slate-700 dark:text-slate-300">Settings</h2>
        <div className="flex items-center gap-0.5">
          {canReset && (
            <button
              type="button"
              onClick={onReset}
              className="rounded px-1.5 py-1 text-slate-500 hover:bg-slate-100 hover:text-slate-900 focus-visible:outline-2 focus-visible:outline-brand-500 dark:hover:bg-slate-800 dark:hover:text-slate-100"
            >
              ↺ Reset
            </button>
          )}
          <button
            type="button"
            onClick={onClose}
            aria-label="Close settings"
            title="Close settings"
            className="rounded p-1.5 text-slate-500 hover:bg-slate-100 hover:text-slate-900 focus-visible:outline-2 focus-visible:outline-brand-500 dark:hover:bg-slate-800 dark:hover:text-slate-100"
          >
            <X aria-hidden className="size-3.5" />
          </button>
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto pt-3">{children}</div>
    </div>
  )
}
