import type { Config } from '../config'

export type UpstreamDeps = {
  config: Config
  fetch: typeof fetch
}

type UpstreamRequest = {
  method?: 'GET' | 'POST'
  body?: unknown
  requestId: string
  /** From `?_simulate=N`, already checked against PLAYGROUND_FAULTS. */
  simulate?: number
  signal?: AbortSignal
}

/**
 * The only place that talks to the inference API, and the only place the key is used.
 * `_simulate` goes to the mock as-is. The real API never sees it: we answer with the
 * requested status ourselves, in the mock's error shape.
 */
export function callUpstream(deps: UpstreamDeps, path: string, req: UpstreamRequest): Promise<Response> {
  const { config } = deps
  if (req.simulate !== undefined && config.upstreamKind !== 'mock') {
    return Promise.resolve(simulatedResponse(req.simulate))
  }

  const url = new URL(config.parasailBaseUrl + path)
  if (req.simulate !== undefined) url.searchParams.set('_simulate', String(req.simulate))

  return deps.fetch(url, {
    method: req.method ?? 'GET',
    headers: {
      Authorization: `Bearer ${config.parasailApiKey}`,
      'X-Request-Id': req.requestId,
      ...(req.body === undefined ? {} : { 'Content-Type': 'application/json' }),
    },
    body: req.body === undefined ? undefined : JSON.stringify(req.body),
    signal: req.signal,
  })
}

function simulatedResponse(status: number): Response {
  return Response.json(
    {
      error: {
        type: 'simulated_error',
        code: status,
        message: `Simulated ${status} response (injected by the playground).`,
      },
    },
    { status },
  )
}

/** The upstream's own error message, if its body has one. Bounded, and never logged as-is. */
export async function readUpstreamMessage(res: Response): Promise<string | undefined> {
  try {
    const body: unknown = await res.json()
    const message = (body as { error?: { message?: unknown } })?.error?.message
    return typeof message === 'string' ? message.slice(0, 500) : undefined
  } catch {
    return undefined
  }
}
