import { useEffect, useState, type KeyboardEvent, type ReactNode } from 'react'
import { InfoTip } from '../ui/info-tip'
import { Slider } from '../ui/slider'

/** A setting's label row: name, a dot if it differs from the default, and an ⓘ explanation. */
export function FieldLabel({ htmlFor, label, changed, tip, aside }: { htmlFor?: string; label: string; changed?: boolean; tip: ReactNode; aside?: ReactNode }) {
  return (
    <div className="mb-1 flex items-center justify-between gap-2">
      <span className="flex items-center gap-1.5">
        <label htmlFor={htmlFor} className="text-xs font-medium text-slate-700 dark:text-slate-300">
          {label}
        </label>
        {changed && <span className="size-1.5 rounded-full bg-brand-500" title="Changed from the default" />}
        <InfoTip label={label}>{tip}</InfoTip>
      </span>
      {aside}
    </div>
  )
}

type NumberFieldProps = {
  id?: string
  value: number | undefined
  onChange: (value: number | undefined) => void
  /** Returns the message to show, or undefined if the value is fine. */
  validate: (value: number) => string | undefined
  onValidity: (valid: boolean) => void
  step?: number
  allowEmpty?: boolean
  placeholder?: string
  className?: string
  label: string
  /** For callers that show the message themselves (the slider row shows it full width). */
  onErrorChange?: (message: string | undefined) => void
}

/**
 * A number box that lets you type freely ("0.", "", "-") and only passes on
 * values that are valid. While it's invalid, the message shows under it and
 * Run is disabled, so what you see is always what gets sent.
 */
export function NumberField({ id, value, onChange, validate, onValidity, step, allowEmpty, placeholder, className, label, onErrorChange }: NumberFieldProps) {
  const [text, setText] = useState(value === undefined ? '' : String(value))
  const [error, setErrorState] = useState<string>()
  const setError = (message: string | undefined) => {
    setErrorState(message)
    onErrorChange?.(message)
  }

  // Follow outside changes (Reset, the slider) unless the box already says the same number.
  useEffect(() => {
    setText((t) => (t !== '' && Number(t) === value) || (t === '' && value === undefined) ? t : value === undefined ? '' : String(value))
    setErrorState(undefined)
    onErrorChange?.(undefined)
    onValidity(true)
    // Runs only when the value changes from outside; `onErrorChange` is deliberately left out.
  }, [value, onValidity])

  const change = (next: string) => {
    setText(next)
    if (next.trim() === '' && allowEmpty) {
      setError(undefined)
      onValidity(true)
      onChange(undefined)
      return
    }
    const message = validate(next.trim() === '' ? Number.NaN : Number(next))
    setError(message)
    onValidity(!message)
    if (!message) onChange(Number(next))
  }

  return (
    <div className={className}>
      <input
        id={id}
        type="text"
        inputMode="decimal"
        value={text}
        step={step}
        placeholder={placeholder}
        aria-label={label}
        aria-invalid={Boolean(error)}
        onChange={(e) => change(e.target.value)}
        className={`w-full rounded-md border bg-transparent px-2 py-1 font-mono text-xs tabular-nums focus-visible:outline-2 focus-visible:-outline-offset-1 focus-visible:outline-brand-500 ${
          error ? 'border-red-500' : 'border-slate-400 dark:border-slate-600'
        }`}
      />
      {error && !onErrorChange && <FieldError message={error} />}
    </div>
  )
}

function FieldError({ message }: { message: string }) {
  return (
    <p role="alert" className="mt-1 text-[11px] text-red-600 dark:text-red-400">
      {message}
    </p>
  )
}

type SliderInputProps = {
  id: string
  /** For screen readers: "Temperature", or "Temperature for B" when A and B differ. */
  label: string
  value: number
  min: number
  max: number
  step: number
  onChange: (value: number) => void
  validate: (value: number) => string | undefined
  onValidity: (valid: boolean) => void
}

/** Slider for feel, number box for exact values. The caller puts the label above it (one label, or one for A and B). */
export function SliderInput({ id, label, value, min, max, step, onChange, validate, onValidity }: SliderInputProps) {
  const [error, setError] = useState<string>()
  return (
    <div>
      <div className="flex items-start gap-3">
        <div className="flex-1 pt-1.5">
          <Slider value={value} min={min} max={max} step={step} onChange={(v) => onChange(Number(v.toFixed(2)))} label={label} />
        </div>
        <NumberField
          id={id}
          label={label}
          value={value}
          onChange={(v) => v !== undefined && onChange(v)}
          validate={validate}
          onValidity={onValidity}
          onErrorChange={setError}
          step={step}
          className="w-16"
        />
      </div>
      {error && <FieldError message={error} />}
    </div>
  )
}

/** Stop sequences as chips: type, press Enter, ✕ to remove. At most `max`. The caller puts the label above it. */
export function StopInput({ id, value, onChange, max }: { id: string; value: string[]; onChange: (v: string[]) => void; max: number }) {
  const [draft, setDraft] = useState('')
  const [error, setError] = useState<string>()

  const add = () => {
    const s = draft
    if (!s) return
    if (value.includes(s)) return setError('Already added.')
    if (s.length > 100) return setError('Each stop sequence is limited to 100 characters.')
    onChange([...value, s])
    setDraft('')
    setError(undefined)
  }

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      add()
    } else if (e.key === 'Backspace' && draft === '' && value.length > 0) {
      onChange(value.slice(0, -1))
    }
  }

  return (
    <div>
      <div className="flex flex-wrap items-center gap-1.5 rounded-md border border-slate-400 p-1.5 focus-within:outline-2 focus-within:-outline-offset-1 focus-within:outline-brand-500 dark:border-slate-600">
        {value.map((s) => (
          <span key={s} className="inline-flex items-center gap-1 rounded bg-slate-100 px-1.5 py-0.5 font-mono text-[11px] dark:bg-slate-800">
            {JSON.stringify(s).slice(1, -1)}
            <button type="button" aria-label={`Remove ${s}`} onClick={() => onChange(value.filter((x) => x !== s))} className="text-slate-400 hover:text-slate-900 dark:hover:text-slate-100">
              ✕
            </button>
          </span>
        ))}
        {value.length < max && (
          <input
            id={id}
            value={draft}
            onChange={(e) => {
              setDraft(e.target.value)
              setError(undefined)
            }}
            onKeyDown={onKeyDown}
            onBlur={add}
            placeholder={value.length === 0 ? 'Type, then Enter' : ''}
            className="min-w-16 flex-1 bg-transparent px-1 font-mono text-[11px] outline-none placeholder:font-sans placeholder:text-slate-400"
          />
        )}
      </div>
      {error && <p className="mt-1 text-[11px] text-red-600 dark:text-red-400">{error}</p>}
    </div>
  )
}
