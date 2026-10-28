import { Hono } from 'hono'
import { AGENT_TOKEN_HOURS, RUNS_PER_AGENT_TOKEN, type AgentTokenResponse } from '../../shared/agent-token'
import type { AgentTokens } from '../agent-token'
import type { AppEnv } from '../env'
import { errorJson } from '../errors'
import { MCP_PATH } from '../middleware/preview-gate'
import { publicOrigin, sameOrigin } from '../origin'

/**
 * POST /api/agent-token: a token for a coding agent, made for someone signed in.
 * The gate keeps agent tokens out of here, so a token can't make another one.
 */
export function agentTokenRoutes({ agentTokens }: { agentTokens: AgentTokens }) {
  const app = new Hono<AppEnv>()

  app.post('/', async (c) => {
    if (!sameOrigin(c)) {
      return errorJson(c, 403, { type: 'unauthorized', source: 'playground', retryable: false, message: "Requests from web pages on other sites aren't accepted." })
    }
    const body = (await c.req.json().catch(() => undefined)) as { hours?: unknown } | undefined
    const hours = AGENT_TOKEN_HOURS.find((h) => h === body?.hours) ?? AGENT_TOKEN_HOURS[0]
    const { token, id, expiresAt } = agentTokens.mint(hours)
    console.log(JSON.stringify({ event: 'agent_token_created', requestId: c.get('requestId'), agentToken: id, expiresAt: new Date(expiresAt).toISOString() }))

    c.header('Cache-Control', 'no-store')
    return c.json<AgentTokenResponse>({ token, expiresAt: new Date(expiresAt).toISOString(), mcpUrl: publicOrigin(c) + MCP_PATH, runs: RUNS_PER_AGENT_TOKEN })
  })

  return app
}
