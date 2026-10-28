import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto'
import type { AgentTokenHours } from '../shared/agent-token'

// Agent tokens: what a coding agent sends to /api/mcp
// instead of the playground password. A signed-in person makes one; it opens the
// MCP endpoint and nothing else, until it expires. Nothing is stored: the signature
// proves this server made it, and changing the password revokes every token.

const PREFIX = 'pgt_'
const SHAPE = /^pgt_([A-Za-z0-9_-]{8})\.(\d{1,12})\.([A-Za-z0-9_-]{43})$/

export type AgentToken = {
  /** Safe to log, and the key for the token's run allowance. */
  id: string
  expiresAt: number
}

export class AgentTokens {
  private readonly key: Buffer

  constructor(
    password: string | undefined,
    private readonly now: () => number,
  ) {
    // Without a password there's no gate, so a token only names its agent in the logs.
    this.key = createHmac('sha256', password ?? randomBytes(32))
      .update('playground-agent-token-v1')
      .digest()
  }

  mint(hours: AgentTokenHours): AgentToken & { token: string } {
    const id = randomBytes(6).toString('base64url')
    const expiresAt = this.now() + hours * 3_600_000
    const body = `${id}.${Math.floor(expiresAt / 1000)}`
    return { token: `${PREFIX}${body}.${this.sign(body)}`, id, expiresAt }
  }

  /** The token's ID and expiry, or undefined if it's malformed, forged or expired. */
  verify(token: string | undefined): AgentToken | undefined {
    const match = token?.match(SHAPE)
    if (!match) return undefined
    const [, id, seconds, signature] = match as unknown as [string, string, string, string]
    const expected = this.sign(`${id}.${seconds}`)
    if (!timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) return undefined
    const expiresAt = Number(seconds) * 1000
    return expiresAt > this.now() ? { id, expiresAt } : undefined
  }

  /** The bearer token on a request, checked. */
  fromHeader(authorization: string | undefined): AgentToken | undefined {
    return this.verify(authorization?.match(/^Bearer\s+(\S+)$/i)?.[1])
  }

  private sign(body: string): string {
    return createHmac('sha256', this.key).update(body).digest('base64url')
  }
}
