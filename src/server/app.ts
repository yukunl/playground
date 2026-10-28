import { Hono } from 'hono'
import type { ApiErrorBody } from '../shared/api-error'
import type { Health, ModelsResponse } from '../shared/models'
import { AgentTokens } from './agent-token'
import type { Config } from './config'
import type { AppEnv } from './env'
import { errorJson } from './errors'
import { previewGate } from './middleware/preview-gate'
import { requestId } from './middleware/request-id'
import { PRICES_AS_OF } from './model-table'
import { agentTokenRoutes } from './routes/agent-token'
import { chatRoutes } from './routes/chat'
import { mcpRoutes } from './routes/mcp'
import { ModelCatalog } from './upstream/model-catalog'
import { DEFAULT_TIMINGS, type StreamTimings } from './upstream/stream-guard'
import { parseSimulate } from './upstream/simulate'
import { UpstreamFailure } from './upstream/translate-error'

export type AppDeps = {
  config: Config
  fetch?: typeof fetch
  now?: () => number
  /** Stream timeouts and heartbeat; tests pass short ones. */
  timings?: StreamTimings
}

/**
 * The BFF's routes. Serving the built page is added in index.ts, so tests stay
 * API-only; the preview gate is registered first, so it covers the page too.
 */
export function createApp({ config, fetch = globalThis.fetch, now = Date.now, timings = DEFAULT_TIMINGS }: AppDeps): Hono<AppEnv> {
  const app = new Hono<AppEnv>()
  const catalog = new ModelCatalog({ config, fetch, now })
  const agentTokens = new AgentTokens(config.playgroundPassword, now)

  app.use('/api/*', requestId())
  if (config.playgroundPassword) previewGate(app, config.playgroundPassword, agentTokens)

  // Liveness: answers 200 whenever this process is up. If it failed when the
  // upstream was down, the platform would restart a healthy server.
  app.get('/api/health', (c) => {
    catalog.warm(c.get('requestId'))
    return c.json<Health>({
      ok: true,
      version: config.version,
      upstream: catalog.upstreamStatus(),
      upstreamKind: config.upstreamKind,
      faultsEnabled: config.faultsEnabled,
    })
  })

  app.get('/api/models', async (c) => {
    const id = c.get('requestId')
    const simulate = parseSimulate(c.req.query('_simulate'), config.faultsEnabled)
    try {
      const list = simulate === undefined ? await catalog.list(id) : await catalog.listSimulated(id, simulate)
      c.header('Cache-Control', 'no-store')
      return c.json<ModelsResponse>({
        data: list.models,
        fetchedAt: new Date(list.fetchedAt).toISOString(),
        stale: list.stale,
        ...(list.models.some((m) => m.priceSource === 'table') ? { pricesAsOf: PRICES_AS_OF } : {}),
      })
    } catch (err) {
      if (err instanceof UpstreamFailure) return errorJson(c, err.httpStatus, err.error)
      throw err
    }
  })

  app.route('/api/chat', chatRoutes({ config, fetch, catalog, now, timings }))
  app.route('/api/agent-token', agentTokenRoutes({ agentTokens }))
  app.route('/api/mcp', mcpRoutes({ config, fetch, catalog, now, agentTokens }))

  app.all('/api/*', (c) =>
    errorJson(c, 404, {
      type: 'invalid_request',
      source: 'playground',
      retryable: false,
      message: `No API endpoint at ${c.req.method} ${c.req.path}.`,
    }),
  )

  app.onError((err, c) => {
    const id = c.get('requestId') ?? 'none'
    console.error(JSON.stringify({ event: 'unhandled_error', requestId: id, error: err.message }))
    return c.json<ApiErrorBody>(
      {
        error: {
          type: 'internal_error',
          source: 'playground',
          retryable: false,
          message: 'Something went wrong inside the playground.',
          requestId: id,
        },
      },
      500,
    )
  })

  return app
}
