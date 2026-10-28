import { Hono, type Context } from 'hono'
import { bodyLimit } from 'hono/body-limit'
import { RUNS_PER_AGENT_TOKEN } from '../../shared/agent-token'
import type { Config } from '../config'
import type { AgentTokens } from '../agent-token'
import type { AppEnv } from '../env'
import { Limiter } from '../mcp/complete'
import { toolDefinitions, TOOLS, type ToolResult } from '../mcp/tools'
import { publicOrigin, sameOrigin } from '../origin'
import type { ModelCatalog } from '../upstream/model-catalog'

const MAX_BODY_BYTES = 1024 * 1024
/** Newest first; an agent asking for one of these gets it, any other gets the newest. */
const PROTOCOL_VERSIONS = ['2025-11-25', '2025-06-18', '2025-03-26']
/** Upstream calls at once, across every agent. The take-home key rate-limits at four. */
const CONCURRENT_CALLS = 2

const INSTRUCTIONS =
  "Tools for trying Parasail models from your own agent. list_models gives the IDs and prices. run sends one setup (model, system prompt, settings) to a few inputs and returns each answer with its speed and cost, measured by the playground. You do the comparing and judging, for example against answers the person expects. When you have a top one or two, open_in_playground makes a link that shows them side by side in the playground with your claims, so the person can run them live and decide. Tell the person what you measured, and give them the link."

type Deps = { config: Config; fetch: typeof fetch; catalog: ModelCatalog; now: () => number; agentTokens: AgentTokens }

type RpcId = string | number
type RpcMessage = { jsonrpc?: unknown; id?: unknown; method?: unknown; params?: unknown }

/**
 * POST /api/mcp: an MCP server over Streamable HTTP, in its simplest form. Each
 * message is one POST answered with one JSON response: no sessions and no stream
 * from server to agent, so GET is refused, as the spec allows.
 */
export function mcpRoutes(deps: Deps) {
  const app = new Hono<AppEnv>()
  const limiter = new Limiter(CONCURRENT_CALLS)
  /** Runs each agent token has used. In memory: a restart gives every token its allowance back. */
  const used = new Map<string, number>()

  app.on(['GET', 'DELETE'], '/', (c) => c.body(null, 405, { Allow: 'POST' }))

  app.post(
    '/',
    bodyLimit({ maxSize: MAX_BODY_BYTES, onError: (c) => rpcError(c, null, -32600, 'The request is larger than 1 MB.', 413) }),
    async (c) => {
      if (!sameOrigin(c)) return rpcError(c, null, -32600, "Requests from web pages on other sites aren't accepted.", 403)
      const version = c.req.header('mcp-protocol-version')
      if (version && !PROTOCOL_VERSIONS.includes(version)) return rpcError(c, null, -32600, `Unsupported MCP protocol version: ${version}.`, 400)

      let message: RpcMessage
      try {
        message = await c.req.json()
      } catch {
        return rpcError(c, null, -32700, 'The body is not JSON.', 400)
      }
      if (!message || typeof message !== 'object' || Array.isArray(message) || message.jsonrpc !== '2.0') {
        return rpcError(c, null, -32600, 'Expected one JSON-RPC 2.0 message.', 400)
      }
      // Notifications (no id) and the agent's responses need no answer.
      if (typeof message.method !== 'string' || (typeof message.id !== 'string' && typeof message.id !== 'number')) return c.body(null, 202)
      const id = message.id
      const params = (message.params && typeof message.params === 'object' ? message.params : {}) as Record<string, unknown>

      switch (message.method) {
        case 'initialize': {
          const asked = params.protocolVersion
          return rpcResult(c, id, {
            protocolVersion: typeof asked === 'string' && PROTOCOL_VERSIONS.includes(asked) ? asked : PROTOCOL_VERSIONS[0],
            capabilities: { tools: {} },
            serverInfo: { name: 'parasail-playground', title: 'Parasail Playground', version: deps.config.version },
            instructions: INSTRUCTIONS,
          })
        }
        case 'ping':
          return rpcResult(c, id, {})
        case 'tools/list':
          return rpcResult(c, id, { tools: toolDefinitions() })
        case 'tools/call':
          return callTool(c, id, params)
        default:
          return rpcError(c, id, -32601, `Unknown method: ${message.method}.`)
      }
    },
  )

  async function callTool(c: Context<AppEnv>, id: RpcId, params: Record<string, unknown>) {
    const tool = TOOLS.find((t) => t.name === params.name)
    if (!tool) return rpcError(c, id, -32602, `Unknown tool: ${String(params.name)}. The tools are ${TOOLS.map((t) => t.name).join(', ')}.`)

    const requestId = c.get('requestId')
    const startedAt = deps.now()
    // Signed in with the password (a browser, or Basic Auth) or no gate: no allowance to keep.
    const token = deps.agentTokens.fromHeader(c.req.header('authorization'))
    let runs = 0
    const allow = (count: number) => {
      if (!token) return true
      const before = used.get(token.id) ?? 0
      if (before + count > RUNS_PER_AGENT_TOKEN) return false
      used.set(token.id, before + count)
      runs += count
      return true
    }

    let result: ToolResult
    try {
      result = await tool.call(params.arguments ?? {}, {
        upstream: deps,
        models: async () => (await deps.catalog.list(requestId)).models,
        limiter,
        allow,
        requestId,
        signal: c.req.raw.signal,
        origin: publicOrigin(c),
      })
    } catch (err) {
      if (c.req.raw.signal.aborted) throw err
      result = { content: [{ type: 'text', text: `The playground couldn't do that: ${(err as Error).message}` }], isError: true }
    }

    // Sizes and outcomes only, never prompts or answers.
    const cost = (result.structuredContent as { totalCostUsd?: unknown } | undefined)?.totalCostUsd
    console.log(
      JSON.stringify({
        event: 'mcp_call',
        requestId,
        tool: tool.name,
        agentToken: token?.id ?? null,
        outcome: result.isError ? 'tool_error' : 'ok',
        runs,
        ...(typeof cost === 'number' ? { costUsd: cost } : {}),
        durationMs: deps.now() - startedAt,
      }),
    )
    return rpcResult(c, id, result)
  }

  return app
}

function rpcResult(c: Context<AppEnv>, id: RpcId, result: unknown) {
  return c.json({ jsonrpc: '2.0', id, result })
}

function rpcError(c: Context<AppEnv>, id: RpcId | null, code: number, message: string, status: 200 | 400 | 403 | 413 = 200) {
  return c.json({ jsonrpc: '2.0', id, error: { code, message } }, status)
}
