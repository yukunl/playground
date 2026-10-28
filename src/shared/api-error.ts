// The one error shape every /api response uses.

export type ErrorType =
  | 'invalid_request'
  | 'context_too_long'
  | 'model_not_found'
  | 'rate_limited'
  | 'inference_unavailable'
  | 'network_error'
  | 'stream_interrupted'
  | 'service_misconfigured'
  | 'unauthorized'
  | 'internal_error'

/** Who owns the fix: the user's connection, our BFF (Speedboat), or the inference API. */
export type ErrorSource = 'network' | 'playground' | 'inference'

export type ApiError = {
  type: ErrorType
  source: ErrorSource
  /** Plain text, for logs and bots. The UI builds its own wording from `type` and `details`. */
  message: string
  details?: Record<string, unknown>
  /** The upstream's HTTP status when the failure came from upstream, shown small for developers. */
  status?: number
  retryable: boolean
  retryAfterMs?: number
  /** This attempt. */
  requestId: string
  /** The answer, across all its attempts. Only chat requests have one. */
  runId?: string
}

export type ApiErrorBody = { error: ApiError }
