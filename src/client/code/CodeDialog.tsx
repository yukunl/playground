import { Check, Copy } from 'lucide-react'
import { Tabs } from 'radix-ui'
import { useRef, useState } from 'react'
import type { Column } from '../chat/types'
import { Dialog } from '../ui/dialog'
import { codeBody, snippet, type CodeLanguage } from './snippets'

type Props = {
  open: boolean
  onOpenChange: (open: boolean) => void
  columns: Column[]
  /** In Compare, the column the code starts on. */
  focusedId: string
  draft: string
  /** An agent's name for the choice, else the model, as the Compare tabs show it. */
  columnName: (col: Column) => string
}

const LANGUAGES: { value: CodeLanguage; label: string }[] = [
  { value: 'curl', label: 'curl' },
  { value: 'python', label: 'Python' },
]

/** The setup as a call to Parasail's API, for a developer to take into their own app. */
export function CodeDialog({ open, onOpenChange, ...form }: Props) {
  // Kept between openings, so someone who wants Python isn't sent back to curl each time.
  const [language, setLanguage] = useState<CodeLanguage>('curl')
  return (
    <Dialog open={open} onOpenChange={onOpenChange} title="Code" wide>
      {open && <CodeForm {...form} language={language} onLanguageChange={setLanguage} />}
    </Dialog>
  )
}

type FormProps = Omit<Props, 'open' | 'onOpenChange'> & { language: CodeLanguage; onLanguageChange: (language: CodeLanguage) => void }

function CodeForm({ columns, focusedId, draft, columnName, language, onLanguageChange }: FormProps) {
  const [columnId, setColumnId] = useState(focusedId)
  const [copied, setCopied] = useState<'yes' | 'failed'>()
  const code = useRef<HTMLPreElement>(null)

  const col = columns.find((c) => c.id === columnId) ?? columns[0]!
  const text = snippet(language, codeBody(col, draft))

  const changed = <T,>(set: (value: T) => void) => (value: T) => {
    set(value)
    setCopied(undefined)
  }

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text)
      setCopied('yes')
    } catch {
      // Clipboard access can be refused; the code is selected so it can be copied by hand.
      setCopied('failed')
      if (code.current) window.getSelection()?.selectAllChildren(code.current)
    }
  }

  return (
    <div className="space-y-4 text-sm">
      {columns.length > 1 && (
        <div role="group" aria-label="Column" className="flex w-fit max-w-full rounded-md border border-slate-300 p-0.5 dark:border-slate-700">
          {columns.map((c, i) => {
            const on = c.id === col.id
            return (
              <button
                key={c.id}
                type="button"
                aria-pressed={on}
                onClick={() => changed(setColumnId)(c.id)}
                className={`min-w-0 truncate rounded px-2 py-0.5 text-xs focus-visible:outline-2 focus-visible:outline-brand-500 ${
                  on ? 'bg-brand-100 font-medium text-brand-900 dark:bg-brand-950 dark:text-brand-100' : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-100'
                }`}
              >
                <span className="mr-1.5 font-semibold">{i === 0 ? 'A' : 'B'}</span>
                {columnName(c)}
              </button>
            )
          })}
        </div>
      )}

      <Tabs.Root value={language} onValueChange={(value) => changed(onLanguageChange)(value as CodeLanguage)}>
        <div className="flex items-center justify-between gap-2">
          <Tabs.List aria-label="Language" className="flex rounded-md border border-slate-300 p-0.5 dark:border-slate-700">
            {LANGUAGES.map(({ value, label }) => (
              <Tabs.Trigger
                key={value}
                value={value}
                className="rounded px-2 py-0.5 text-xs text-slate-600 hover:bg-slate-100 hover:text-slate-900 focus-visible:outline-2 focus-visible:outline-brand-500 data-[state=active]:bg-brand-100 data-[state=active]:font-medium data-[state=active]:text-brand-900 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-100 dark:data-[state=active]:bg-brand-950 dark:data-[state=active]:text-brand-100"
              >
                {label}
              </Tabs.Trigger>
            ))}
          </Tabs.List>
          <button
            type="button"
            onClick={() => void copy()}
            className="flex items-center gap-1.5 rounded-md bg-slate-950 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-500 dark:bg-slate-200 dark:text-slate-950 dark:hover:bg-white"
          >
            {copied === 'yes' ? <Check aria-hidden className="size-4" /> : <Copy aria-hidden className="size-4" />}
            {copied === 'yes' ? 'Copied' : 'Copy code'}
          </button>
        </div>
        {LANGUAGES.map(({ value }) => (
          <Tabs.Content
            key={value}
            value={value}
            className="mt-2 max-h-[min(24rem,50dvh)] overflow-auto rounded-md border border-slate-200 bg-slate-50 focus-visible:outline-2 focus-visible:outline-brand-500 dark:border-slate-800 dark:bg-slate-900"
          >
            <pre ref={code} className="w-max p-3 font-mono text-xs leading-relaxed text-slate-800 dark:text-slate-200">
              {text}
            </pre>
          </Tabs.Content>
        ))}
      </Tabs.Root>

      <p role="status" className={copied === 'failed' ? 'text-xs text-amber-700 dark:text-amber-400' : 'sr-only'}>
        {copied === 'failed' ? 'Couldn’t copy automatically. The code is selected: copy it with ⌘C.' : copied === 'yes' ? 'Code copied' : ''}
      </p>
    </div>
  )
}
