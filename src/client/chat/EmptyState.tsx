const EXAMPLES = [
  'Explain prompt caching in 3 bullets.',
  'Write a Python function to dedupe a list while keeping order.',
  'Summarize this support ticket in one line: "Since the update, exports time out after 30s on files over 50 MB."',
]

/** A new chat in Single: three prompts that run with one click. */
export function EmptyState({ onPick, disabled }: { onPick: (text: string) => void; disabled: boolean }) {
  return (
    <div className="pt-[12vh] text-center">
      <h2 className="text-lg font-semibold tracking-tight">Ready when you are.</h2>
      <p className="mt-1 text-sm text-slate-500">Pick a model, write a prompt, press Enter.</p>
      <div className="mx-auto mt-6 flex max-w-xl flex-col gap-2">
        {EXAMPLES.map((text) => (
          <button
            key={text}
            type="button"
            disabled={disabled}
            onClick={() => onPick(text)}
            className="rounded-md border border-slate-200 px-3 py-2 text-left text-sm text-slate-700 hover:border-slate-300 hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-brand-500 disabled:opacity-50 dark:border-slate-800 dark:text-slate-300 dark:hover:border-slate-700 dark:hover:bg-slate-900"
          >
            {text}
          </button>
        ))}
      </div>
    </div>
  )
}
