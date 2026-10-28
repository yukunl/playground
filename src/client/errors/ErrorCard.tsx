import { Check, ChevronRight, Copy } from 'lucide-react'
import { useEffect, useState, type ReactNode } from 'react'
import { DEFAULT_SETTINGS, type Settings } from '../../shared/chat'
import { MAX_RETRIES } from '../chat/retry'
import type { AssistantMessage } from '../chat/types'
import { estimateTokens, formatMs } from '../format'
import { describeError, type Bucket } from './copy'
import { debugInfo } from './debug-info'

export type RunActions = {
  /** Only for the last answer: run its message again. */
  runAgain?: (overrides?: Partial<Settings>) => void
  switchModel: () => void
  newChat: () => void
  stop: () => void
  appVersion: string
}

// Repeated under dark: so the dark border colour doesn't paint over the stripe.
const STRIPE: Record<Bucket, string> = {
  you: 'border-l-sky-500 dark:border-l-sky-500',
  itself: 'border-l-amber-500 dark:border-l-amber-500',
  us: 'border-l-red-500 dark:border-l-red-500',
}

/**
 * A failed or interrupted run, in the conversation where the answer would have been
 * (design §12.5). Never takes focus; announced politely to screen readers.
 */
export function ErrorCard({ message: m, model, actions }: { message: AssistantMessage; model: string; actions: RunActions }) {
  const error = m.error!
  const copy = describeError(error, { model, tokens: m.text ? estimateTokens(m.text) : undefined })
  const Icon = copy.icon
  const field = typeof error.details?.field === 'string' ? error.details.field.replace(/^settings\./, '') : undefined

  return (
    <div role="status" aria-live="polite" className={`mt-3 rounded-md border border-l-4 border-slate-200 bg-slate-50/60 p-3 dark:border-slate-800 dark:bg-slate-900/40 ${STRIPE[copy.bucket]}`}>
      <p className="flex items-center gap-1.5 text-sm font-semibold">
        <Icon aria-hidden className="size-4 shrink-0" />
        {copy.headline}
      </p>
      <p className="mt-1 text-sm text-slate-700 dark:text-slate-300">{copy.body}</p>

      {copy.actions.length > 0 && (
        <div className="mt-2.5 flex flex-wrap gap-2">
          {copy.actions.includes('resetSetting') && field && field in DEFAULT_SETTINGS && actions.runAgain && (
            <CardButton onClick={() => actions.runAgain?.({ [field]: DEFAULT_SETTINGS[field as keyof typeof DEFAULT_SETTINGS] })}>
              Reset {field} and run again
            </CardButton>
          )}
          {copy.actions.includes('retry') && actions.runAgain && <CardButton onClick={() => actions.runAgain?.()}>{copy.retryLabel ?? 'Retry'}</CardButton>}
          {copy.actions.includes('switchModel') && <CardButton onClick={actions.switchModel}>Switch model</CardButton>}
          {copy.actions.includes('newChat') && <CardButton onClick={actions.newChat}>New chat</CardButton>}
          {copy.actions.includes('copyDebugInfo') && <CopyDebugInfo text={debugInfo(m, actions.appVersion)} />}
        </div>
      )}

      <details className="group mt-2.5">
        <summary className="flex cursor-pointer list-none items-center justify-between gap-2 font-mono text-[11px] text-slate-500">
          <span className="flex flex-wrap gap-x-3">
            {error.status ? <span>{error.status}</span> : null}
            <span>{m.runId}</span>
          </span>
          <span className="flex items-center gap-0.5 font-sans">
            <ChevronRight aria-hidden className="size-3 transition-transform group-open:rotate-90" /> Details
          </span>
        </summary>
        <AttemptTimeline message={m} />
      </details>
    </div>
  )
}

/** While waiting to retry: what happened, a live countdown, and Cancel. */
export function RetryingCard({ message: m, model, onCancel }: { message: AssistantMessage; model: string; onCancel: () => void }) {
  const retrying = m.retrying!
  const secondsLeft = useCountdown(retrying.until)
  const copy = describeError(retrying.error, { model, retrying: { seconds: secondsLeft, retry: retrying.retry } })
  const Icon = copy.icon
  return (
    <div role="status" aria-live="polite" className={`rounded-md border border-l-4 border-slate-200 p-3 dark:border-slate-800 ${STRIPE[copy.bucket]}`}>
      <p className="flex items-center gap-1.5 text-sm font-semibold">
        <Icon aria-hidden className="size-4 shrink-0" />
        {copy.headline}
      </p>
      <p className="mt-1 text-sm text-slate-700 dark:text-slate-300">{copy.body}</p>
      <div className="mt-2 flex items-center justify-between gap-2">
        <span className="flex flex-wrap gap-x-3 font-mono text-[11px] text-slate-500">
          {retrying.error.status ? <span>{retrying.error.status}</span> : null}
          <span>{m.runId}</span>
          <span className="font-sans">
            Attempt {m.attempts.length} of {MAX_RETRIES + 1}
          </span>
        </span>
        <CardButton onClick={onCancel}>Cancel</CardButton>
      </div>
    </div>
  )
}

/** Every attempt with its timing and the waits between them, plus the settings that were sent. */
function AttemptTimeline({ message: m }: { message: AssistantMessage }) {
  const s = m.settingsUsed
  const totalWait = m.attempts.reduce((sum, a) => sum + (a.waitedMs ?? 0), 0)
  return (
    <div className="mt-2 space-y-1 font-mono text-[11px] text-slate-600 dark:text-slate-400">
      {m.attempts.map((a) => (
        <div key={a.requestId}>
          <div className="flex flex-wrap gap-x-3">
            <span>attempt {a.number}</span>
            <span>{a.status ?? '—'}</span>
            <span>{a.errorType ?? 'ok'}</span>
            <span>{a.durationMs !== undefined ? formatMs(a.durationMs) : ''}</span>
            <span className="text-slate-500">{a.requestId}</span>
          </div>
          {a.waitedMs !== undefined && <div className="pl-4 text-slate-500">waited {(a.waitedMs / 1000).toFixed(1)}s</div>}
        </div>
      ))}
      {m.attempts.length > 1 && (
        <div className="text-slate-500">
          {m.attempts.length - 1} {m.attempts.length === 2 ? 'retry' : 'retries'}, {(totalWait / 1000).toFixed(1)}s waiting
        </div>
      )}
      <div className="flex flex-wrap gap-x-3 pt-1 text-slate-500">
        <span>sent: {s.model}</span>
        <span>temperature {s.temperature}</span>
        <span>top-p {s.topP}</span>
        <span>max tokens {s.maxTokens}</span>
        {s.stop.length ? <span>stop ×{s.stop.length}</span> : null}
        {s.seed !== undefined ? <span>seed {s.seed}</span> : null}
        <span>{s.system ? `system prompt ${s.system.length} chars` : 'no system prompt'}</span>
      </div>
    </div>
  )
}

function CopyDebugInfo({ text }: { text: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <CardButton
      onClick={async () => {
        await navigator.clipboard.writeText(text)
        setCopied(true)
        setTimeout(() => setCopied(false), 1500)
      }}
    >
      {copied ? <Check aria-hidden className="size-3.5" /> : <Copy aria-hidden className="size-3.5" />}
      {copied ? 'Copied' : 'Copy debug info'}
    </CardButton>
  )
}

function CardButton({ children, onClick }: { children: ReactNode; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex items-center gap-1 rounded-md border border-slate-300 bg-white px-2.5 py-1 text-xs font-medium hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-brand-500 dark:border-slate-700 dark:bg-slate-900 dark:hover:bg-slate-800"
    >
      {children}
    </button>
  )
}

/** Whole seconds until `until`, ticking; null when there's no deadline (waiting to come back online). */
function useCountdown(until: number | null): number | null {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (until === null) return
    const timer = setInterval(() => setNow(Date.now()), 200)
    return () => clearInterval(timer)
  }, [until])
  return until === null ? null : Math.max(0, Math.ceil((until - now) / 1000))
}
