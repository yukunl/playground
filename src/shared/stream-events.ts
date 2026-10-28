// The three events the BFF streams to the browser.
// Each is one JSON object on an SSE `data:` line.
import type { ApiError } from './api-error'

export type Usage = {
  promptTokens: number
  completionTokens: number
  cachedTokens?: number
}

export type StreamEvent =
  | { type: 'token'; text: string }
  | { type: 'error'; error: ApiError }
  | {
      type: 'done'
      finishReason: 'stop' | 'length'
      /** Missing if the upstream never reported usage. */
      usage?: Usage
      /** null when there's no price for this model, or no usage to price. */
      costUsd: number | null
    }
