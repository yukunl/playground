import type { AssistantMessage } from '../chat/types'

/**
 * A block ready to paste into a support ticket or a Slack thread (design §12.6).
 * IDs, timings and settings only: never prompt or answer text. Support searches
 * the logs for the run ID and finds every attempt.
 */
export function debugInfo(m: AssistantMessage, appVersion: string): string {
  const s = m.settingsUsed
  const e = m.error
  const attempts = m.attempts.map((a) => a.requestId).join(', ')
  const retries = Math.max(0, m.attempts.length - 1)
  const waitedMs = m.attempts.reduce((sum, a) => sum + (a.waitedMs ?? 0), 0)
  const lines = [
    'Parasail Playground debug info',
    `Run:      ${m.runId}   (attempts: ${attempts || m.requestId})`,
    `When:     ${new Date(m.startedAt).toISOString().replace('T', ' ').replace(/\.\d+Z$/, ' UTC')}`,
    `Model:    ${s.model} · temperature ${s.temperature} · top-p ${s.topP} · max tokens ${s.maxTokens}${s.stop.length ? ` · ${s.stop.length} stop` : ''}${s.seed !== undefined ? ` · seed ${s.seed}` : ''}`,
    e
      ? `Error:    ${e.type}${e.status ? ` (${e.status})` : ''} · source: ${e.source}${retries ? ` · ${retries} ${retries === 1 ? 'retry' : 'retries'}, ${(waitedMs / 1000).toFixed(1)}s waiting` : ''}`
      : `Status:   ${m.status}`,
    `App:      ${appVersion}`,
  ]
  return lines.join('\n')
}
