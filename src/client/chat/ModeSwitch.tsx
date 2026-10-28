import { Columns2, MessageCircle, type LucideIcon } from 'lucide-react'

export type Mode = 'single' | 'compare'

const MODES: { mode: Mode; label: string; title: string; Icon: LucideIcon }[] = [
  { mode: 'single', label: 'Single', title: 'Chat with one setup', Icon: MessageCircle },
  { mode: 'compare', label: 'Compare', title: 'Send one prompt to two setups, A and B', Icon: Columns2 },
]

type Props = {
  mode: Mode
  onChange: (mode: Mode) => void
  /** Why the mode can't change right now (an answer is streaming). */
  disabledReason?: string
}

/** Single or Compare, first in the prompt box. Two options, so a switch rather than a menu. */
export function ModeSwitch({ mode, onChange, disabledReason }: Props) {
  return (
    <div role="group" aria-label="Mode" className="flex shrink-0 rounded-md border border-slate-300 p-0.5 dark:border-slate-700">
      {MODES.map(({ mode: m, label, title, Icon }) => {
        const on = m === mode
        return (
          <button
            key={m}
            type="button"
            aria-pressed={on}
            disabled={Boolean(disabledReason) && !on}
            title={disabledReason && !on ? disabledReason : title}
            onClick={() => !on && onChange(m)}
            className={`flex items-center gap-1 rounded px-2 py-0.5 text-xs focus-visible:outline-2 focus-visible:outline-brand-500 disabled:opacity-50 ${
              on ? 'bg-brand-100 font-medium text-brand-900 dark:bg-brand-950 dark:text-brand-100' : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-100'
            }`}
          >
            <Icon aria-hidden className="size-3.5" />
            {label}
          </button>
        )
      })}
    </div>
  )
}
