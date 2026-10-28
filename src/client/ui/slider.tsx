import { Slider as RadixSlider } from 'radix-ui'

type Props = {
  value: number
  min: number
  max: number
  step: number
  onChange: (value: number) => void
  label: string
}

/** Radix handles the keyboard (arrows, Home/End, Page Up/Down) and ARIA; this is just the look. */
export function Slider({ value, min, max, step, onChange, label }: Props) {
  return (
    <RadixSlider.Root
      value={[value]}
      min={min}
      max={max}
      step={step}
      onValueChange={([v]) => v !== undefined && onChange(v)}
      className="relative flex h-5 w-full touch-none select-none items-center"
    >
      <RadixSlider.Track className="relative h-1 grow rounded-full bg-slate-200 dark:bg-slate-800">
        <RadixSlider.Range className="absolute h-full rounded-full bg-brand-500" />
      </RadixSlider.Track>
      <RadixSlider.Thumb
        aria-label={label}
        className="block size-3.5 rounded-full border border-slate-300 bg-white shadow-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-500 dark:border-slate-600 dark:bg-slate-100"
      />
    </RadixSlider.Root>
  )
}
