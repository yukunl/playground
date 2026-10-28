import type { RunActions } from '../errors/ErrorCard'
import { describeChanges } from '../settings/settings-logic'
import { MessageView } from './MessageView'
import type { AssistantMessage, Message } from './types'

type Props = {
  messages: Message[]
  /** `runAgain` is only offered on the last answer. */
  actions: RunActions
  canRunAgain: boolean
  /** Friendly model names ("switched to Llama 3.3 70B"). */
  nameOf: (modelId: string) => string
}

/**
 * The conversation. When the settings behind an answer differ from the answer
 * before it, a divider says what changed, so the history stays readable and honest.
 */
export function ChatView({ messages, actions, canRunAgain, nameOf }: Props) {
  let previous: AssistantMessage | undefined
  const lastIndex = messages.length - 1
  const { runAgain, ...rest } = actions

  return (
    <div className="space-y-6">
      {messages.map((m, i) => {
        const next = messages[i + 1]
        let divider: string[] = []
        if (m.role === 'user' && next?.role === 'assistant') {
          if (previous) divider = describeChanges(previous.settingsUsed, next.settingsUsed, nameOf)
          previous = next
        }
        const isLast = i === lastIndex && canRunAgain
        return (
          <div key={m.role === 'assistant' ? m.runId : `u${i}`} className="space-y-6">
            {divider.length > 0 && <Divider changes={divider} />}
            <MessageView
              message={m}
              model={m.role === 'assistant' ? nameOf(m.settingsUsed.model) : ''}
              actions={isLast && runAgain ? { ...rest, runAgain } : rest}
            />
          </div>
        )
      })}
    </div>
  )
}

function Divider({ changes }: { changes: string[] }) {
  return (
    <div className="flex items-center gap-3 text-[11px] text-slate-500" role="separator">
      <span className="h-px flex-1 bg-slate-200 dark:bg-slate-800" />
      <span className="max-w-[80%] text-center">{changes.join(', ')}</span>
      <span className="h-px flex-1 bg-slate-200 dark:bg-slate-800" />
    </div>
  )
}
