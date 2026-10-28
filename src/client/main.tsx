import { StrictMode, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import { ErrorBoundary } from './ui/error-boundary'
import './index.css'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary fallback={(error) => <AppCrashed error={error} />}>
      <App />
    </ErrorBoundary>
  </StrictMode>,
)

/** The last line of defence: a rendering bug anywhere outside a single message. */
function AppCrashed({ error }: { error: Error }) {
  const [copied, setCopied] = useState(false)
  const info = ['Parasail Playground crash', `When:   ${new Date().toISOString()}`, `Error:  ${error.message}`, `Page:   ${location.pathname}`, `Agent:  ${navigator.userAgent}`].join('\n')
  return (
    <main className="mx-auto max-w-md px-4 pt-[20vh] text-center">
      <h1 className="text-lg font-semibold">Something went wrong</h1>
      <p className="mt-2 text-sm text-slate-600 dark:text-slate-400">It’s a bug on our side, not something you did. Reloading gets you going again.</p>
      <div className="mt-5 flex justify-center gap-2">
        <button type="button" onClick={() => location.reload()} className="rounded-md bg-slate-950 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-700 dark:bg-slate-200 dark:text-slate-950 dark:hover:bg-white">
          Reload
        </button>
        <button
          type="button"
          onClick={async () => {
            await navigator.clipboard.writeText(info)
            setCopied(true)
          }}
          className="rounded-md border border-slate-300 px-3 py-1.5 text-sm hover:bg-slate-50 dark:border-slate-700 dark:hover:bg-slate-900"
        >
          {copied ? 'Copied' : 'Copy debug info'}
        </button>
      </div>
    </main>
  )
}
