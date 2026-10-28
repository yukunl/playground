/** Small costs stay readable: $0.000020, $0.0012, $0.34, $12.50. */
export function formatCost(usd: number): string {
  if (usd === 0) return '$0'
  return usd >= 1 ? `$${usd.toFixed(2)}` : `$${usd.toPrecision(2)}`
}

export function formatMs(ms: number): string {
  return ms < 1000 ? `${Math.round(ms)} ms` : `${(ms / 1000).toFixed(1)} s`
}

/** "≈11,000 runs like this per $1": easier to grasp than $0.00009. */
export function runsPerDollar(usd: number): string {
  return Math.round(1 / usd).toLocaleString('en-US')
}

/** A rough live count while streaming; the real count arrives with `done`. */
export function estimateTokens(text: string): number {
  return Math.max(1, Math.round(text.length / 4))
}

/** "just now", "5 min ago", "3 h ago", "yesterday", "4 days ago", then a date. */
export function relativeTime(at: number, now = Date.now()): string {
  const minutes = Math.floor((now - at) / 60_000)
  if (minutes < 1) return 'just now'
  if (minutes < 60) return `${minutes} min ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours} h ago`
  const days = Math.floor(hours / 24)
  if (days === 1) return 'yesterday'
  if (days < 7) return `${days} days ago`
  const date = new Date(at)
  const sameYear = date.getFullYear() === new Date(now).getFullYear()
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', ...(sameYear ? {} : { year: 'numeric' }) })
}
