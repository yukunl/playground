import { lazy, Suspense, useEffect, useState } from 'react'
import { MAX_OUTPUT_TOKENS } from '../../shared/chat'
import { ErrorCard, RetryingCard, type RunActions } from '../errors/ErrorCard'
import { estimateTokens, formatCost, formatMs, runsPerDollar } from '../format'
import { ErrorBoundary } from '../ui/error-boundary'
import type { AssistantMessage, Message } from './types'

// The Markdown renderer (react-markdown + remark-gfm) is a big share of the page's code.
// It starts loading as soon as this module runs, in parallel with the first paint, and an
// answer that arrives before it does shows as plain text until then.
const loadMarkdown = import('./Markdown')
const Markdown = lazy(() => loadMarkdown.then((m) => ({ default: m.Markdown })))

type Props = {
  message: Message
  /** Friendly name of the model that answered. */
  model: string
  /** `actions.runAgain` is only passed for the last answer, when it's finished. */
  actions: RunActions
}

export function MessageView({ message, model, actions }: Props) {
  if (message.role === 'user') {
    return (
      <div className="flex justify-end">
        <div className="max-w-[85%] whitespace-pre-wrap rounded-lg bg-slate-100 px-3 py-2 text-sm dark:bg-slate-800/70">
          {message.text}
        </div>
      </div>
    )
  }
  return <AssistantView message={message} model={model} actions={actions} />
}

function AssistantView({ message: m, model, actions }: { message: AssistantMessage; model: string; actions: RunActions }) {
  const streaming = m.status === 'streaming'
  const onRunAgain = actions.runAgain
  return (
    <div className="text-sm">
      {m.text ? (
        <div className={streaming ? 'is-streaming' : undefined}>
          {/* One answer that fails to render (an odd markdown case) can't take the page down. */}
          <ErrorBoundary fallback={() => <UnrenderableMessage text={m.text} />}>
            <Suspense fallback={<PlainText text={m.text} />}>
              <Markdown text={m.text} />
            </Suspense>
          </ErrorBoundary>
        </div>
      ) : (
        streaming && !m.retrying && <Waiting since={m.startedAt} />
      )}

      {streaming && m.retrying && <RetryingCard message={m} model={model} onCancel={actions.stop} />}

      {m.status === 'done' && m.finishReason === 'length' && (
        <p className="mt-2 text-xs text-amber-700 dark:text-amber-400">
          Cut off at {m.settingsUsed.maxTokens} tokens.{' '}
          {onRunAgain && m.settingsUsed.maxTokens < MAX_OUTPUT_TOKENS ? (
            <button
              type="button"
              onClick={() => onRunAgain({ maxTokens: Math.min(MAX_OUTPUT_TOKENS, m.settingsUsed.maxTokens * 2) })}
              className="underline underline-offset-2 hover:text-amber-900 dark:hover:text-amber-200"
            >
              Raise max tokens to {Math.min(MAX_OUTPUT_TOKENS, m.settingsUsed.maxTokens * 2)} and run again
            </button>
          ) : (
            'Raise Max tokens to get the rest.'
          )}
        </p>
      )}
      {m.status === 'cancelled' && (
        <p className="mt-2 text-xs text-slate-500">
          Stopped {m.text ? `after ≈${estimateTokens(m.text)} tokens` : 'before the first token'}
        </p>
      )}
      {(m.status === 'failed' || m.status === 'interrupted') && m.error && <ErrorCard message={m} model={model} actions={actions} />}

      <div className="mt-2 flex items-baseline justify-between gap-3">
        <StatsLine message={m} />
        {onRunAgain && m.status !== 'failed' && m.status !== 'interrupted' && (
          <button
            type="button"
            onClick={() => onRunAgain()}
            title="Run the last message again with the current settings (⌘⇧↵)"
            className="shrink-0 rounded px-1.5 py-0.5 text-xs text-slate-500 hover:bg-slate-100 hover:text-slate-900 focus-visible:outline-2 focus-visible:outline-brand-500 dark:hover:bg-slate-800 dark:hover:text-slate-100"
          >
            ↻ Run again
          </button>
        )}
      </div>
    </div>
  )
}

function PlainText({ text }: { text: string }) {
  return <pre className="whitespace-pre-wrap font-sans text-sm">{text}</pre>
}

function UnrenderableMessage({ text }: { text: string }) {
  const [plain, setPlain] = useState(false)
  return plain ? (
    <PlainText text={text} />
  ) : (
    <p className="text-xs text-slate-500">
      This message couldn’t be displayed.{' '}
      <button type="button" onClick={() => setPlain(true)} className="underline underline-offset-2">
        Show as plain text
      </button>
    </p>
  )
}

/** Nothing for the first 300 ms (a flash of spinner looks laggier than nothing), then a sign of life. */
function Waiting({ since }: { since: number }) {
  const elapsed = useElapsed(since)
  if (elapsed < 300) return <div className="h-5" />
  return (
    <p className="shimmer h-5 text-sm text-slate-500" role="status">
      {elapsed < 5000 ? 'Waiting for the model…' : 'Still waiting… long prompts take longer to read.'}
    </p>
  )
}

function StatsLine({ message: m }: { message: AssistantMessage }) {
  const now = useElapsed(m.startedAt, m.status === 'streaming') + m.startedAt
  if (m.status === 'streaming') {
    if (!m.text || !m.firstTokenAt) return null
    const tokens = m.receivedChars === undefined ? estimateTokens(m.text) : Math.max(1, Math.round(m.receivedChars / 4))
    const seconds = ((m.receivedAt ?? now) - m.firstTokenAt) / 1000
    return (
      <p className="flex flex-wrap items-center gap-x-3 font-mono text-xs tabular-nums text-slate-500">
        <span className="font-sans">
          <span aria-hidden className="mr-1.5 inline-block size-1.5 animate-pulse rounded-full bg-teal-600 align-middle motion-reduce:animate-none dark:bg-teal-500" />
          Streaming
        </span>
        <span>≈{tokens} tokens</span>
        {seconds > 0.5 && <span>{Math.round(tokens / seconds)} tok/s</span>}
      </p>
    )
  }
  if (m.status !== 'done' || !m.firstTokenAt || !m.finishedAt) return null

  const tokens = m.usage?.completionTokens ?? estimateTokens(m.text)
  // The model's own time to first token: from the attempt that succeeded, not counting retry waits.
  const lastAttempt = m.attempts.at(-1)
  const ttft = m.firstTokenAt - (lastAttempt?.startedAt ?? m.startedAt)
  const retries = Math.max(0, m.attempts.length - 1)
  const generationSeconds = (m.finishedAt - m.firstTokenAt) / 1000
  const parts = [
    `${m.usage ? '' : '≈'}${tokens} tokens`,
    `${formatMs(ttft)} to first token`,
    ...(generationSeconds > 0 ? [`${Math.round(tokens / generationSeconds)} tok/s`] : []),
    ...(typeof m.costUsd === 'number' ? [`≈${formatCost(m.costUsd)}`] : []),
    ...(retries > 0 ? [`after ${retries} ${retries === 1 ? 'retry' : 'retries'}`] : []),
  ]
  const details = [
    m.usage && `Prompt ${m.usage.promptTokens} tokens, completion ${m.usage.completionTokens} tokens`,
    m.usage?.cachedTokens !== undefined && `Cached prompt tokens: ${m.usage.cachedTokens}`,
    typeof m.costUsd === 'number' && m.costUsd > 0 && `≈${runsPerDollar(m.costUsd)} runs like this per $1 (list prices)`,
    `Model ${m.settingsUsed.model}, temperature ${m.settingsUsed.temperature}, top-p ${m.settingsUsed.topP}, max tokens ${m.settingsUsed.maxTokens}`,
    `Run ${m.runId}, request ${m.requestId}`,
  ].filter(Boolean)

  return (
    <p className="flex cursor-default flex-wrap gap-x-3 font-mono text-xs tabular-nums text-slate-500" title={details.join('\n')}>
      {parts.map((part) => (
        <span key={part}>{part}</span>
      ))}
    </p>
  )
}

/** Milliseconds since `since`, ticking while `live`. */
function useElapsed(since: number, live = true): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!live) return
    const timer = setInterval(() => setNow(Date.now()), 250)
    return () => clearInterval(timer)
  }, [live])
  return now - since
}
