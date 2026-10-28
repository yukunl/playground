import type { Column } from './chat/types'
import { estimateTokens, formatCost } from './format'

/** What a panel, or the whole chat, has used so far. */
export type UsageTotal = {
  tokens: number
  costUsd: number
  /** Some answers had no usage report, so their tokens are estimated from the text. */
  estimated: boolean
}

/**
 * Tokens are prompt plus completion where the API reported them; for an answer
 * without a report (stopped, failed mid-way), the completion is estimated from its
 * text. Cost is the sum of each answer's estimate at list prices. Runs in `skip`
 * aren't counted: a second panel starts with copies of the first one's answers,
 * which were paid for once.
 */
export function columnUsage(col: Column, skip: ReadonlySet<string> = new Set()): UsageTotal {
  let tokens = 0
  let costUsd = 0
  let estimated = false
  for (const m of col.messages) {
    if (m.role !== 'assistant' || skip.has(m.runId)) continue
    if (m.usage) {
      tokens += m.usage.promptTokens + m.usage.completionTokens
    } else if (m.text) {
      tokens += estimateTokens(m.text)
      estimated = true
    }
    if (typeof m.costUsd === 'number') costUsd += m.costUsd
  }
  return { tokens, costUsd, estimated }
}

/** Each panel's own usage: the second skips the answers it copied from the first. */
export function panelUsages(columns: Column[]): UsageTotal[] {
  const first = new Set(columns[0]?.messages.flatMap((m) => (m.role === 'assistant' ? [m.runId] : [])))
  return columns.map((col, i) => columnUsage(col, i === 0 ? new Set() : first))
}

/** Both panels together, each run counted once. */
export function chatUsage(columns: Column[]): UsageTotal {
  return panelUsages(columns).reduce((sum, u) => ({ tokens: sum.tokens + u.tokens, costUsd: sum.costUsd + u.costUsd, estimated: sum.estimated || u.estimated }), {
    tokens: 0,
    costUsd: 0,
    estimated: false,
  })
}

/** "812 tokens", "≈812 tokens", plus "≈$0.000068" when there's a cost. */
export function formatUsage(u: UsageTotal): string[] {
  return [`${u.estimated ? '≈' : ''}${u.tokens.toLocaleString('en-US')} tokens`, ...(u.costUsd > 0 ? [`≈${formatCost(u.costUsd)}`] : [])]
}
