import { SlidersHorizontal } from 'lucide-react'
import type { Model } from '../../shared/models'
import { ModelPicker } from '../settings/ModelPicker'
import { formatUsage, type UsageTotal } from '../usage'
import { Composer } from './Composer'
import { ModeSwitch, type Mode } from './ModeSwitch'
import type { Column } from './types'

type Props = {
  draft: string
  onDraftChange: (text: string) => void
  onRun: () => void
  onStop: () => void
  streaming: boolean
  /** Why Run can't send yet (no model, a setting that can't be sent), if anything. */
  blockedReason: string | undefined
  /** One column in Single, A and B in Compare. */
  columns: Column[]
  onModeChange: (mode: Mode) => void
  models: Model[]
  modelsLoading: boolean
  pricesAsOf: string | undefined
  /** The column whose model chip is open, or null. ⌘K opens the focused one. */
  pickerOpenFor: string | null
  onPickerOpenChange: (columnId: string, open: boolean) => void
  onModelChange: (columnId: string, model: string) => void
  settingsShown: boolean
  onToggleSettings: () => void
  /** The whole chat's tokens and cost so far. */
  usage: UsageTotal
}

/** The prompt box, like Arena's: the text, then the mode, a model chip per side, Settings and Run. */
export function PromptBox({
  draft,
  onDraftChange,
  onRun,
  onStop,
  streaming,
  blockedReason,
  columns,
  onModeChange,
  models,
  modelsLoading,
  pricesAsOf,
  pickerOpenFor,
  onPickerOpenChange,
  onModelChange,
  settingsShown,
  onToggleSettings,
  usage,
}: Props) {
  const comparing = columns.length > 1
  return (
    <div className="mx-auto w-full max-w-3xl px-4 pb-4 pt-2">
      <Composer
        value={draft}
        onChange={onDraftChange}
        onRun={onRun}
        onStop={onStop}
        streaming={streaming}
        canRun={Boolean(draft.trim()) && !blockedReason}
        blockedReason={blockedReason}
        {...(comparing ? { placeholder: 'Type once, sent to A and B…' } : {})}
        toolbar={
          <>
            <ModeSwitch mode={comparing ? 'compare' : 'single'} onChange={onModeChange} {...(streaming ? { disabledReason: 'Wait for the answer to finish' } : {})} />
            {columns.map((col, i) => (
              <ModelPicker
                key={col.id}
                compact
                {...(comparing ? { side: i === 0 ? ('A' as const) : ('B' as const) } : {})}
                models={models}
                value={col.settings.model}
                onChange={(id) => onModelChange(col.id, id)}
                open={pickerOpenFor === col.id}
                onOpenChange={(open) => onPickerOpenChange(col.id, open)}
                loading={modelsLoading}
                pricesAsOf={pricesAsOf}
              />
            ))}
          </>
        }
        trailing={
          <button
            type="button"
            onClick={onToggleSettings}
            aria-pressed={settingsShown}
            title={settingsShown ? 'Hide settings' : 'Show settings'}
            className={`flex shrink-0 items-center gap-1 rounded-md px-2 py-1.5 text-xs text-slate-500 hover:bg-slate-100 hover:text-slate-900 focus-visible:outline-2 focus-visible:outline-brand-500 dark:hover:bg-slate-800 dark:hover:text-slate-100 ${settingsShown ? 'bg-slate-100 text-slate-900 dark:bg-slate-800 dark:text-slate-100' : ''}`}
          >
            <SlidersHorizontal aria-hidden className="size-3.5" />
            <span className="max-sm:sr-only">Settings</span>
          </button>
        }
      />
      {/* The running total sits by Run, where the money is spent. */}
      {usage.tokens > 0 && (
        <p className="mt-1.5 flex justify-end gap-x-2 text-xs text-slate-500">
          <span>{comparing ? 'Both panels so far' : 'This chat so far'}</span>
          {formatUsage(usage).map((part) => (
            <span key={part} className="font-mono tabular-nums">
              {part}
            </span>
          ))}
        </p>
      )}
    </div>
  )
}
