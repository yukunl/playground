// What POST /api/agent-token returns: a token for a coding agent.

/** The lifetimes the page offers: a day, or a week. */
export const AGENT_TOKEN_HOURS = [24, 168] as const
export type AgentTokenHours = (typeof AGENT_TOKEN_HOURS)[number]

/** How many answers one token can ask for, so a leaked token can only spend so much. */
export const RUNS_PER_AGENT_TOKEN = 300

export type AgentTokenResponse = {
  /** Shown once; the server keeps no copy. */
  token: string
  expiresAt: string
  /** Where the agent connects: this playground's /api/mcp. */
  mcpUrl: string
  runs: number
}
