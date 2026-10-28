import type { ApiError } from '../../shared/api-error'

export const MAX_RETRIES = 3
export const MAX_TOTAL_AUTO_WAIT_MS = 10_000 // across all retries of one run

/**
 * How long to wait before the next retry, or null for "don't retry automatically"
 * (design §22.2). Only asked before the first token: once text is on screen, the
 * run loop never retries by itself, because the answer isn't safe to repeat.
 *
 * `waitedSoFarMs` is the automatic waiting already spent on this run; `random`
 * is passed in so tests are deterministic.
 */
export function nextRetryDelay(err: ApiError, retriesSoFar: number, waitedSoFarMs: number, random: () => number = Math.random): number | null {
  if (!err.retryable) return null // "you" and "us" errors: never
  if (retriesSoFar >= MAX_RETRIES) return null // the third retry failed → give-up card

  const backoff = 1000 * 2 ** retriesSoFar // 1s, 2s, 4s
  const jittered = backoff / 2 + random() * (backoff / 2) // spreads out users who all failed at once
  const delay = Math.max(err.retryAfterMs ?? 0, jittered) // never shorter than the server asked

  return waitedSoFarMs + delay <= MAX_TOTAL_AUTO_WAIT_MS ? delay : null // over budget: hand back to the user
}
