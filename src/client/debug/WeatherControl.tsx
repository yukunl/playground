import { ChevronRight, CloudSun } from 'lucide-react'
import { useState } from 'react'
import { WEATHER, type WeatherPreset } from './weather'

type Props = {
  preset: WeatherPreset
  onChange: (preset: WeatherPreset) => void
  /** From /api/health: whether the server honours `?_simulate` and fault switches. */
  faultsEnabled: boolean | undefined
}

/**
 * A hidden panel (open with `?debug`) for triggering each failure in one click,
 * instead of editing URLs. It sits collapsed as a small pill so it
 * doesn't cover the page; the chosen preset applies to every run until changed.
 */
export function WeatherControl({ preset, onChange, faultsEnabled }: Props) {
  const [open, setOpen] = useState(false)
  const active = preset !== 'clear'

  return (
    <section aria-label="Weather control" className="fixed bottom-24 left-4 z-30 text-xs">
      {open && (
        <div className="mb-2 w-72 rounded-lg border border-slate-200 bg-white/95 p-3 shadow-lg backdrop-blur dark:border-slate-800 dark:bg-slate-950/95">
          {faultsEnabled === false && (
            <p className="mb-2 rounded bg-amber-50 px-2 py-1 text-amber-900 dark:bg-amber-950 dark:text-amber-200">
              Fault switches are off on this server (PLAYGROUND_FAULTS), so presets have no effect.
            </p>
          )}
          <div role="radiogroup" aria-label="Weather preset" className="space-y-1">
            {(Object.keys(WEATHER) as WeatherPreset[]).map((key) => (
              <label
                key={key}
                className={`flex cursor-pointer gap-2 rounded-md px-2 py-1.5 ${preset === key ? 'bg-slate-100 dark:bg-slate-800' : 'hover:bg-slate-50 dark:hover:bg-slate-900'}`}
              >
                <input
                  type="radio"
                  name="weather"
                  checked={preset === key}
                  onChange={() => {
                    onChange(key)
                    setOpen(false)
                  }}
                  className="mt-0.5 accent-brand-600"
                />
                <span>
                  <span className="block font-medium">{WEATHER[key].label}</span>
                  <span className="block text-slate-500">{WEATHER[key].shows}</span>
                </span>
              </label>
            ))}
          </div>
        </div>
      )}
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className={`flex items-center gap-1.5 rounded-full border px-3 py-1.5 shadow-sm backdrop-blur ${
          active
            ? 'border-amber-400 bg-amber-50/95 text-amber-900 dark:border-amber-600 dark:bg-amber-950/95 dark:text-amber-200'
            : 'border-slate-300 bg-white/95 dark:border-slate-700 dark:bg-slate-900/95'
        }`}
      >
        <CloudSun aria-hidden className="size-3.5" />
        Weather: {WEATHER[preset].label}
        <ChevronRight aria-hidden className={`size-3 transition-transform ${open ? '-rotate-90' : ''}`} />
      </button>
    </section>
  )
}
