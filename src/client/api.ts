import type { ApiError } from '../shared/api-error'

/** A failed /api call, carrying the BFF's error shape. */
export class ApiRequestError extends Error {
  constructor(readonly error: ApiError) {
    super(error.message)
  }
}

export function getJson<T>(path: string, signal?: AbortSignal): Promise<T> {
  return requestJson<T>(path, { headers: { Accept: 'application/json' }, signal })
}

export function postJson<T>(path: string, body: unknown): Promise<T> {
  return requestJson<T>(path, { method: 'POST', headers: { Accept: 'application/json', 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
}

async function requestJson<T>(path: string, init: RequestInit): Promise<T> {
  let res: Response
  try {
    res = await fetch(path, init)
  } catch {
    throw new ApiRequestError({
      type: 'network_error',
      source: 'network',
      retryable: true,
      message: "Couldn't reach the playground server.",
      requestId: 'none',
    })
  }

  const body: unknown = await res.json().catch(() => undefined)
  if (!res.ok) {
    const error = (body as { error?: ApiError } | undefined)?.error
    // Signed out: the session ended, or Vite served this page without the gate in
    // development. Sign in, then come back here, #fragment and all.
    if (error?.type === 'unauthorized') {
      window.location.assign(`/login?next=${encodeURIComponent(location.pathname + location.search)}${location.hash}`)
    }
    throw new ApiRequestError(
      error ?? {
        type: 'internal_error',
        source: 'playground',
        retryable: false,
        status: res.status,
        message: `The playground server answered ${res.status}.`,
        requestId: res.headers.get('x-request-id') ?? 'none',
      },
    )
  }
  return body as T
}
