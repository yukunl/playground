import { Popover } from 'radix-ui'
import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import type { Model } from '../../shared/models'
import { formatContext, formatPricing, matchesQuery, modelName } from '../model-names'

type Props = {
  models: Model[]
  value: string
  onChange: (id: string) => void
  open: boolean
  onOpenChange: (open: boolean) => void
  loading: boolean
  /** When the list prices in our model table were copied. */
  pricesAsOf?: string
  /** A chip in the prompt box, like Arena's: the model's name and ▾, no facts. */
  compact?: boolean
  /** Compare: "A" or "B", shown before the name. */
  side?: 'A' | 'B'
}

/**
 * The model picker: a searchable list, featured models first. ⌘K opens it from
 * anywhere; type "8b", press Enter, and focus goes back to wherever it was.
 */
export function ModelPicker({ models, value, onChange, open, onOpenChange, loading, pricesAsOf, compact = false, side }: Props) {
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)
  const returnFocusTo = useRef<HTMLElement | null>(null)
  const current = models.find((m) => m.id === value)
  // Already ordered by the server: featured (table order), then the rest.
  const matches = useMemo(() => models.filter((m) => matchesQuery(m, query)), [models, query])
  const grouped = models.some((m) => m.featured)

  useEffect(() => {
    if (open) {
      returnFocusTo.current = document.activeElement as HTMLElement | null
      setQuery('')
      setActive(Math.max(0, models.findIndex((m) => m.id === value)))
    }
  }, [open, models, value])

  // Keep the highlighted row in view while moving with the arrow keys.
  useEffect(() => {
    if (open) document.getElementById(optionId(matches[active]?.id))?.scrollIntoView({ block: 'nearest' })
  }, [active, open, matches])

  const choose = (model: Model | undefined) => {
    if (!model) return
    onChange(model.id)
    onOpenChange(false)
  }

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActive((i) => Math.min(i + 1, matches.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActive((i) => Math.max(i - 1, 0))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      choose(matches[active])
    }
  }

  return (
    <Popover.Root open={open} onOpenChange={onOpenChange}>
      {compact ? (
        <Popover.Trigger
          disabled={models.length === 0}
          title={side ? `${side}'s model (⌘K)` : 'Model (⌘K)'}
          className="flex min-w-0 max-w-full items-center gap-1 rounded-md border border-slate-300 px-2 py-1 text-left text-xs hover:bg-slate-100 focus-visible:outline-2 focus-visible:outline-brand-500 disabled:opacity-50 dark:border-slate-700 dark:hover:bg-slate-800"
        >
          {side && <span className="shrink-0 font-semibold text-slate-500">{side}</span>}
          <span className="truncate font-medium">{current ? modelName(current, current.id) : loading ? 'Loading models…' : value || 'No models'}</span>
          <span aria-hidden className="shrink-0 text-slate-400">▾</span>
        </Popover.Trigger>
      ) : (
        <Popover.Trigger
          disabled={models.length === 0}
          className="w-full rounded-md border border-slate-400 px-2.5 py-2 text-left hover:border-slate-500 focus-visible:outline-2 focus-visible:outline-brand-500 disabled:opacity-50 dark:border-slate-600 dark:hover:border-slate-500"
        >
          <span className="flex items-center justify-between gap-2">
            <span className="truncate text-sm font-medium">
              {current ? modelName(current, current.id) : loading ? 'Loading models…' : value || 'No models'}
            </span>
            <span className="shrink-0 text-xs text-slate-400">▾</span>
          </span>
          {current && <ModelFacts model={current} pricesAsOf={pricesAsOf} />}
        </Popover.Trigger>
      )}

      <Popover.Portal>
        <Popover.Content
          align="start"
          sideOffset={4}
          onCloseAutoFocus={(e) => {
            // Back to where focus was before (the input box after ⌘K), not to this trigger.
            // Never to something behind an open dialog, such as the settings drawer.
            const target = returnFocusTo.current
            const dialog = document.querySelector('[role="dialog"]')
            if (target && document.contains(target) && (!dialog || dialog.contains(target))) {
              e.preventDefault()
              target.focus()
            }
          }}
          className="z-50 w-[min(24rem,calc(100vw-2rem))] rounded-lg border border-slate-200 bg-white p-1.5 shadow-xl dark:border-slate-800 dark:bg-slate-950"
        >
          <input
            autoFocus
            value={query}
            onChange={(e) => {
              setQuery(e.target.value)
              setActive(0)
            }}
            onKeyDown={onKeyDown}
            placeholder={`Search ${models.length} models…`}
            role="combobox"
            aria-expanded="true"
            aria-controls="model-list"
            aria-activedescendant={matches[active] ? optionId(matches[active].id) : undefined}
            className="mb-1 w-full rounded-md bg-slate-100 px-2.5 py-1.5 text-sm placeholder:text-slate-400 focus-visible:outline-2 focus-visible:outline-brand-500 dark:bg-slate-900"
          />
          <ul id="model-list" role="listbox" aria-label="Models" className="max-h-80 overflow-y-auto">
            {matches.map((m, i) => (
              <ModelRow
                key={m.id}
                model={m}
                heading={grouped ? headingBefore(matches, i) : undefined}
                active={i === active}
                current={m.id === value}
                pricesAsOf={pricesAsOf}
                onHover={() => setActive(i)}
                onChoose={() => choose(m)}
              />
            ))}
            {matches.length === 0 && <li className="px-2.5 py-2 text-sm text-slate-500">No model matches “{query}”.</li>}
          </ul>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  )
}

/** "Featured" above the first featured row, "Other models" above the first of the rest. */
function headingBefore(list: Model[], i: number): string | undefined {
  const m = list[i]!
  if (i === 0) return m.featured ? 'Featured' : 'Other models'
  return !m.featured && list[i - 1]!.featured ? 'Other models' : undefined
}

function ModelRow(props: {
  model: Model
  heading?: string
  active: boolean
  current: boolean
  pricesAsOf?: string
  onHover: () => void
  onChoose: () => void
}) {
  const { model: m } = props
  return (
    <>
      {props.heading && (
        <li role="presentation" className="px-2.5 pb-1 pt-2 text-xs font-medium text-slate-500">
          {props.heading}
        </li>
      )}
      <li
        id={optionId(m.id)}
        role="option"
        aria-selected={props.active}
        onMouseEnter={props.onHover}
        onMouseDown={(e) => e.preventDefault()}
        onClick={props.onChoose}
        className={`cursor-pointer rounded-md px-2.5 py-1.5 ${props.active ? 'bg-slate-100 dark:bg-slate-800' : ''}`}
      >
        <span className="flex items-center justify-between gap-2 text-sm">
          <span className="truncate">{modelName(m, m.id)}</span>
          {props.current && <span className="text-xs text-brand-600 dark:text-brand-400">current</span>}
        </span>
        <ModelFacts model={m} pricesAsOf={props.pricesAsOf} />
      </li>
    </>
  )
}

function ModelFacts({ model, pricesAsOf }: { model: Model; pricesAsOf?: string }) {
  const pricing = formatPricing(model)
  const priceNote = model.priceSource === 'table' && pricesAsOf ? `Parasail list prices, copied ${pricesAsOf}` : undefined
  return (
    // Wraps rather than truncates, so a narrow panel still shows the context and price in full.
    <span className="mt-0.5 flex flex-wrap gap-x-2 text-[11px] tabular-nums text-slate-500" title={priceNote}>
      <span className="max-w-full truncate font-mono">{model.id}</span>
      {model.contextLength ? <span>{formatContext(model.contextLength)} context</span> : null}
      {pricing ? <span>{pricing}</span> : model.featured ? null : <span>no price listed</span>}
    </span>
  )
}

function optionId(id: string | undefined): string {
  return `model-${(id ?? '').replace(/[^A-Za-z0-9_-]/g, '_')}`
}
