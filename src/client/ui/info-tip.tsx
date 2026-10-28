import { Tooltip } from 'radix-ui'
import type { ReactNode } from 'react'

/** An ⓘ that explains a setting on hover or keyboard focus. Needs a Tooltip.Provider above it. */
export function InfoTip({ children, label }: { children: ReactNode; label: string }) {
  return (
    <Tooltip.Root delayDuration={200}>
      <Tooltip.Trigger asChild>
        <button
          type="button"
          aria-label={`About ${label}`}
          className="inline-flex size-4 items-center justify-center rounded-full text-[11px] text-slate-400 hover:text-slate-700 focus-visible:outline-2 focus-visible:outline-brand-500 dark:hover:text-slate-200"
        >
          ⓘ
        </button>
      </Tooltip.Trigger>
      <Tooltip.Portal>
        <Tooltip.Content
          side="left"
          sideOffset={6}
          className="z-50 max-w-64 rounded-md bg-slate-900 px-2.5 py-1.5 text-xs leading-relaxed text-slate-100 shadow-lg dark:bg-slate-100 dark:text-slate-900"
        >
          {children}
          <Tooltip.Arrow className="fill-slate-900 dark:fill-slate-100" />
        </Tooltip.Content>
      </Tooltip.Portal>
    </Tooltip.Root>
  )
}
