import { ChevronDown, Sparkles, X } from 'lucide-react'
import { useState } from 'react'
import type { Column, Proposal } from '../chat/types'

type Props = {
  proposal: Proposal
  columns: Column[]
  nameOf: (modelId: string) => string
  /** Whether a model is in this playground's list; always true while the list loads. */
  isAvailable: (modelId: string) => boolean
  onDismiss: () => void
}

/**
 * Above the columns when a chat came from an agent's proposal.
 * Everything here is the agent's claim. The answers come only from running the
 * columns, and the banner says which of the two you're looking at.
 */
export function ProposalBanner({ proposal, columns, nameOf, isAvailable, onDismiss }: Props) {
  const answered = columns.some((col) => col.messages.some((m) => m.role === 'assistant'))
  // Open before the first run, when the reasoning is what you came for; closed after, to make room for answers.
  const [open, setOpen] = useState(!answered)
  const choices = columns.filter((col) => col.proposed)
  const label = (col: Column) => (col.id === 'col_a' ? 'A' : 'B')
  const missing = choices.filter((col) => !isAvailable(col.proposed!.settings.model))

  return (
    <section
      aria-label={`Proposal from ${proposal.by}`}
      className="border-b border-brand-100 bg-brand-50/70 px-4 py-2 text-xs text-slate-700 dark:border-brand-900 dark:bg-brand-950/40 dark:text-slate-300"
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="flex items-center gap-1.5 text-sm text-slate-900 dark:text-slate-100">
            <Sparkles aria-hidden className="size-3.5 shrink-0 text-brand-500 dark:text-brand-300" />
            <span className="truncate">
              <span className="mr-2 font-medium">Proposed by {proposal.by}</span>
              {proposal.title}
            </span>
          </p>
          <p className="mt-0.5">
            {answered
              ? 'These are the agent’s claims. The answers below were run live here, not sent by the agent.'
              : `These are the agent’s claims. Press ⌘↵ to run ${choices.length > 1 ? 'both choices' : 'it'} live and judge the answers yourself.`}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-0.5">
          <button
            type="button"
            onClick={() => setOpen(!open)}
            aria-expanded={open}
            className="flex items-center gap-0.5 rounded px-1.5 py-0.5 text-slate-500 hover:bg-brand-100/70 hover:text-slate-900 dark:hover:bg-brand-900/50 dark:hover:text-slate-100"
          >
            Why
            <ChevronDown aria-hidden className={`size-3.5 transition-transform motion-reduce:transition-none ${open ? 'rotate-180' : ''}`} />
          </button>
          <button
            type="button"
            onClick={onDismiss}
            aria-label="Remove the proposal from this chat"
            title="Remove the proposal (keeps the settings)"
            className="rounded p-1 text-slate-500 hover:bg-brand-100/70 hover:text-slate-900 dark:hover:bg-brand-900/50 dark:hover:text-slate-100"
          >
            <X aria-hidden className="size-3.5" />
          </button>
        </div>
      </div>

      {open && (
        <div className="mt-2 max-h-48 space-y-1.5 overflow-y-auto border-t border-brand-100 pt-2 dark:border-brand-900">
          {proposal.summary && <p className="whitespace-pre-line">{proposal.summary}</p>}
          {choices.map((col) => (
            <p key={col.id}>
              <span className="mr-1.5 inline-block w-4 rounded bg-slate-200 text-center font-semibold dark:bg-slate-700">{label(col)}</span>
              <span className="font-medium text-slate-900 dark:text-slate-100">{col.proposed!.label}</span>
              {col.proposed!.why && <span>: {col.proposed!.why}</span>}
            </p>
          ))}
        </div>
      )}

      {missing.map((col) => (
        <p key={col.id} role="status" className="mt-1.5 text-amber-800 dark:text-amber-300">
          {label(col)} was proposed with {nameOf(col.proposed!.settings.model)}, which isn’t available here
          {col.settings.model !== col.proposed!.settings.model ? `, so it runs on ${nameOf(col.settings.model)}` : ''}.
        </p>
      ))}
    </section>
  )
}
