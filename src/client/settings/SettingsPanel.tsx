import { Dices } from 'lucide-react'
import { Tooltip } from 'radix-ui'
import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from 'react'
import { SettingsSchema, type Settings } from '../../shared/chat'
import type { Model } from '../../shared/models'
import { modelName } from '../model-names'
import { FieldLabel, NumberField, SliderInput, StopInput } from './fields'
import { estimatePromptTokens, isChanged, outputTokenLimit, type Tunable } from './settings-logic'

/** One side's settings: the only one in Single, A or B in Compare. */
type Side = {
  key: 'a' | 'b'
  /** "A" or "B" in Compare. */
  label?: 'A' | 'B'
  settings: Settings
  onChange: (patch: Partial<Settings>) => void
  /** Rough size of that side's conversation so far plus the draft, for the max-tokens ceiling. */
  promptTokens: number
}

type Props = {
  settings: Settings
  onChange: (patch: Partial<Settings>) => void
  promptTokens: number
  /** Compare: B's settings and edits. The props above are then A's. */
  b?: Omit<Side, 'key' | 'label'>
  /** False while any field holds a value that can't be sent; Run is disabled until it's fixed. */
  onValidityChange: (valid: boolean) => void
  models: Model[]
}

/**
 * The brief's parameters plus the system prompt. The model is picked in the
 * prompt box. In Compare every setting has an A control and a B control, each editing its own side.
 */
export function SettingsPanel(props: Props) {
  const { models, b } = props
  const a: Side = { key: 'a', ...(b ? { label: 'A' as const } : {}), settings: props.settings, onChange: props.onChange, promptTokens: props.promptTokens }
  const sides: Side[] = b ? [a, { key: 'b', label: 'B', ...b }] : [a]
  const validity = useValidity(props.onValidityChange)

  // If the panel closes (the drawer on narrow screens) with a half-typed value,
  // the last valid settings stand, so Run shouldn't stay blocked.
  const { onValidityChange } = props
  useEffect(() => () => onValidityChange(true), [onValidityChange])

  const limitOf = (side: Side) => {
    const model = models.find((m) => m.id === side.settings.model)
    return { model, limit: outputTokenLimit(model?.contextLength, side.promptTokens + estimatePromptTokens(side.settings.system)) }
  }
  const checkMaxTokens = (side: Side) => (v: number) => {
    const { model, limit } = limitOf(side)
    return firstError(SettingsSchema.shape.maxTokens, v) ?? (v > limit ? `${model ? modelName(model, model.id) : 'This model'} leaves room for at most ${limit} output tokens here.` : undefined)
  }
  // Each side is checked against its own model: "up to 4,096", or "A up to 4,096, B up to 32,768".
  const limits = sides.map((side) => limitOf(side).limit)
  const limitText = limits.every((l) => l === limits[0]) ? `up to ${fmt(limits[0]!)}` : sides.map((side, i) => `${side.label} up to ${fmt(limits[i]!)}`).join(', ')
  /** Its label, plus "for A" / "for B" in Compare. */
  const named = (label: string, side: Side) => (side.label ? `${label} for ${side.label}` : label)

  return (
    <Tooltip.Provider>
      <div className="space-y-5 px-4 pb-4 pt-1">
        <SettingRow
          field="system"
          label="System prompt"
          tip={
            <>
              <b>System prompt</b> (the <code>system</code> message): instructions the model reads before every message. It's paid for on every
              message, hence the token count. Empty = no system message is sent.
            </>
          }
          sides={sides}
          render={(side, id) => <SystemPromptBox id={id} value={side.settings.system} onChange={(system) => side.onChange({ system })} />}
        />

        <SettingRow
          field="temperature"
          label="Temperature"
          tip={
            <>
              <b>Temperature</b> (<code>temperature</code>): how adventurous the answer is. 0 = predictable, 2 = wild. Applies to your next message.
            </>
          }
          sides={sides}
          render={(side, id) => (
            <SliderInput
              id={id}
              label={named('Temperature', side)}
              value={side.settings.temperature}
              min={0}
              max={2}
              step={0.1}
              onChange={(temperature) => side.onChange({ temperature })}
              validate={(v) => firstError(SettingsSchema.shape.temperature, v)}
              onValidity={validity(`${side.key}:temperature`)}
            />
          )}
        />

        <SettingRow
          field="maxTokens"
          label="Max tokens"
          tip={
            <>
              <b>Max tokens</b> (<code>max_tokens</code>): the longest the answer can be. If it's reached, the answer is cut off and the playground
              says so.
            </>
          }
          aside={<span className="text-[11px] text-slate-500">{limitText}</span>}
          sides={sides}
          render={(side, id) => (
            <NumberField
              id={id}
              label={named('Max tokens', side)}
              value={side.settings.maxTokens}
              onChange={(v) => v !== undefined && side.onChange({ maxTokens: v })}
              validate={checkMaxTokens(side)}
              onValidity={validity(`${side.key}:maxTokens`)}
              step={1}
            />
          )}
        />

        <SettingRow
          field="topP"
          label="Top-p"
          tip={
            <>
              <b>Top-p</b> (<code>top_p</code>): only pick from the most likely words that add up to this probability. 1 = consider everything.
              Usually change this or temperature, not both.
            </>
          }
          sides={sides}
          render={(side, id) => (
            <SliderInput
              id={id}
              label={named('Top-p', side)}
              value={side.settings.topP}
              min={0}
              max={1}
              step={0.05}
              onChange={(topP) => side.onChange({ topP })}
              validate={(v) => firstError(SettingsSchema.shape.topP, v)}
              onValidity={validity(`${side.key}:topP`)}
            />
          )}
        />

        <SettingRow
          field="stop"
          label="Stop sequences"
          tip={
            <>
              <b>Stop sequences</b> (<code>stop</code>): the answer ends as soon as the model writes one of these. Up to 4.
            </>
          }
          sides={sides}
          render={(side, id) => <StopInput id={id} value={side.settings.stop} onChange={(stop) => side.onChange({ stop })} max={4} />}
        />

        <SettingRow
          field="seed"
          label="Seed"
          tip={
            <>
              <b>Seed</b> (<code>seed</code>): the same seed and settings usually give the same answer. Best effort, not guaranteed. Empty =
              random.
            </>
          }
          sides={sides}
          render={(side, id) => (
            <div className="flex gap-2">
              <NumberField
                id={id}
                label={named('Seed', side)}
                value={side.settings.seed}
                onChange={(seed) => side.onChange({ seed })}
                validate={(v) => firstError(SettingsSchema.shape.seed, v)}
                onValidity={validity(`${side.key}:seed`)}
                allowEmpty
                placeholder="empty = random"
                className="flex-1"
              />
              <button
                type="button"
                title="Pick a random seed"
                aria-label={named('Pick a random seed', side)}
                onClick={() => side.onChange({ seed: Math.floor(Math.random() * 2 ** 31) })}
                className="rounded-md border border-slate-300 px-2 hover:bg-slate-100 focus-visible:outline-2 focus-visible:outline-brand-500 dark:border-slate-700 dark:hover:bg-slate-800"
              >
                <Dices aria-hidden className="size-4" />
              </button>
            </div>
          )}
        />
      </div>
    </Tooltip.Provider>
  )
}

type SettingRowProps = {
  field: Tunable
  label: string
  tip: ReactNode
  aside?: ReactNode
  /** One side (Single) or two (Compare). */
  sides: Side[]
  render: (side: Side, inputId: string) => ReactNode
}

/** A setting: its label, then one control, or an A and a B control. */
function SettingRow({ field, label, tip, aside, sides, render }: SettingRowProps) {
  const id = useId()
  return (
    <section>
      <FieldLabel htmlFor={`${id}-${sides[0]!.key}`} label={label} changed={sides.some((s) => isChanged(field, s.settings))} tip={tip} aside={aside} />
      {sides.length === 1 ? (
        render(sides[0]!, `${id}-${sides[0]!.key}`)
      ) : (
        <div className="space-y-2">
          {sides.map((side) => (
            <div key={side.key} className="flex items-start gap-2">
              <span className="w-3 shrink-0 pt-1 text-[11px] font-semibold text-slate-500">{side.label}</span>
              <div className="min-w-0 flex-1">{render(side, `${id}-${side.key}`)}</div>
            </div>
          ))}
        </div>
      )}
    </section>
  )
}

/** Collapsed: the first line. Expanded: a box that grows with the text, with its token count. */
function SystemPromptBox({ id, value, onChange }: { id: string; value: string; onChange: (v: string) => void }) {
  const [open, setOpen] = useState(false)
  const box = useRef<HTMLTextAreaElement>(null)
  const firstLine = value.split('\n')[0]

  useEffect(() => {
    const el = box.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, 320)}px`
  }, [value, open])

  return open ? (
    <>
      <textarea
        id={id}
        ref={box}
        autoFocus
        value={value}
        onChange={(e) => onChange(e.target.value)}
        rows={3}
        placeholder="e.g. You are a concise senior engineer."
        className="w-full resize-none rounded-md border border-slate-400 bg-transparent px-2 py-1.5 text-xs leading-relaxed placeholder:text-slate-400 focus-visible:outline-2 focus-visible:-outline-offset-1 focus-visible:outline-brand-500 dark:border-slate-600"
      />
      <div className="mt-1 flex justify-between text-[11px] text-slate-500">
        <button type="button" onClick={() => setOpen(false)} className="hover:text-slate-900 dark:hover:text-slate-100">
          ▴ Collapse
        </button>
        <span className="tabular-nums">~{estimatePromptTokens(value)} tokens</span>
      </div>
    </>
  ) : (
    <button
      id={id}
      type="button"
      onClick={() => setOpen(true)}
      aria-expanded={false}
      className="w-full truncate rounded-md border border-slate-400 px-2 py-1.5 text-left text-xs hover:border-slate-500 focus-visible:outline-2 focus-visible:outline-brand-500 dark:border-slate-600 dark:hover:border-slate-500"
    >
      {value ? firstLine : <span className="text-slate-500">Add a system prompt</span>}
    </button>
  )
}

/** Tracks which fields are invalid and reports overall validity. Callbacks are stable per field. */
function useValidity(onValidityChange: (valid: boolean) => void) {
  const invalid = useRef(new Set<string>())
  const callbacks = useRef(new Map<string, (valid: boolean) => void>())
  return useCallback(
    (field: string) => {
      let cb = callbacks.current.get(field)
      if (!cb) {
        cb = (valid: boolean) => {
          if (valid) invalid.current.delete(field)
          else invalid.current.add(field)
          onValidityChange(invalid.current.size === 0)
        }
        callbacks.current.set(field, cb)
      }
      return cb
    },
    [onValidityChange],
  )
}

function fmt(n: number): string {
  return n.toLocaleString('en-US')
}

function firstError(schema: { safeParse: (v: unknown) => { success: boolean; error?: { issues: { message: string }[] } } }, value: unknown) {
  const result = schema.safeParse(value)
  return result.success ? undefined : result.error?.issues[0]?.message
}
