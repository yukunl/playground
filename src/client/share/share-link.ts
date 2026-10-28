// Sharing by link. The link carries everything after
// the `#`, which browsers never send to a server: no ID, no storage, no database.
// The payload lives here rather than in src/shared because the server never receives one;
// it only makes them, for an agent's open_in_playground call (src/server/mcp/tools.ts).
import { z } from 'zod'
import { SettingsSchema } from '../../shared/chat'
import type { AssistantMessage, ChatState, Column, Message } from '../chat/types'
import { differingFields } from '../settings/settings-logic'

const PREFIX = '#s='
/** Above this, some apps cut links off, so the dialog warns. */
export const LONG_LINK_CHARS = 8_000
/** "Whole chat" isn't offered above this. */
export const MAX_CHAT_LINK_CHARS = 32_000
/** A link is untrusted input: anything bigger than we'd ever make is refused before decoding. */
const MAX_LINK_CHARS = 100_000
/** And so is anything that decompresses to more than this. */
const MAX_DECODED_BYTES = 2_000_000

export type ShareMode = 'setup' | 'chat'

const ShareMessageSchema = z.object({ role: z.enum(['user', 'assistant']), text: z.string().max(400_000) })

/** An agent's proposal: its claims, shown above the columns. */
const ProposalSchema = z.object({
  by: z.string().trim().min(1).max(40),
  title: z.string().trim().min(1).max(120),
  summary: z.string().trim().max(2_000).optional(),
})

export const SharePayloadSchema = z
  .object({
    v: z.literal(1),
    mode: z.enum(['setup', 'chat']),
    columns: z
      .array(
        z.object({
          settings: SettingsSchema,
          messages: z.array(ShareMessageSchema).max(500).optional(),
          /** Proposals only: the agent's name for this choice, and why it picked it. */
          label: z.string().trim().min(1).max(60).optional(),
          why: z.string().trim().max(1_000).optional(),
        }),
      )
      .min(1)
      .max(2),
    draft: z.string().max(400_000).optional(),
    proposal: ProposalSchema.optional(),
  })
  .superRefine((p, ctx) => {
    // The point of a proposal is that its answers come from running it here, so it never carries any.
    if (p.proposal && (p.mode !== 'setup' || p.columns.some((col) => col.messages)))
      ctx.addIssue({ code: 'custom', path: ['proposal'], message: 'A proposal must be a setup link, with no messages in it.' })
    if (!p.proposal && p.columns.some((col) => col.label !== undefined || col.why !== undefined))
      ctx.addIssue({ code: 'custom', path: ['columns'], message: 'A label or why needs a proposal.' })
  })
export type SharePayload = z.infer<typeof SharePayloadSchema>

/** The link couldn't be read: cut off, edited, too large, or not one of ours. */
export class DamagedLinkError extends Error {
  constructor(readonly reason: string) {
    super(`Damaged share link: ${reason}`)
  }
}

/**
 * "Just the setup" is each column's settings plus the message being typed; "whole
 * chat" adds every message and answer that has text. Run IDs, attempts, costs and
 * dividers are left out to keep links short. An agent's proposal goes along with
 * the setup only (see `keepsProposal`).
 */
export function sharePayload(chat: ChatState, mode: ShareMode, draft: string): SharePayload {
  const proposal = mode === 'setup' && keepsProposal(chat) ? chat.proposal : undefined
  return {
    v: 1,
    mode,
    columns: chat.columns.map((col) => ({
      settings: col.settings,
      ...(mode === 'chat' ? { messages: col.messages.filter((m) => m.text).map((m) => ({ role: m.role, text: m.text })) } : {}),
      ...(proposal && col.proposed ? { label: col.proposed.label, ...(col.proposed.why ? { why: col.proposed.why } : {}) } : {}),
    })),
    ...(mode === 'setup' && draft.trim() ? { draft } : {}),
    ...(proposal ? { proposal } : {}),
  }
}

/** Which settings of a proposed choice have changed since the agent proposed it. */
export function changedSinceProposed(col: Column): string[] {
  return col.proposed ? differingFields(col.proposed.settings, col.settings) : []
}

/**
 * A setup link passes the proposal on only while every proposed choice is as the
 * agent sent it; otherwise your edits would reach the next person as the agent's.
 */
export function keepsProposal(chat: ChatState): boolean {
  return Boolean(chat.proposal) && chat.columns.every((col) => changedSinceProposed(col).length === 0)
}

/** JSON → `deflate` (zlib, with a checksum) → base64url, ready to go after `#s=`. */
export async function encodeShare(payload: SharePayload): Promise<string> {
  const bytes = await transform(new TextEncoder().encode(JSON.stringify(payload)), new CompressionStream('deflate'))
  return toBase64Url(bytes)
}

/** The reverse, checked at every step: a link is untrusted input. Throws `DamagedLinkError`. */
export async function decodeShare(encoded: string): Promise<SharePayload> {
  if (encoded.length > MAX_LINK_CHARS) throw new DamagedLinkError('too long')
  let json: unknown
  try {
    const bytes = await transform(fromBase64Url(encoded), new DecompressionStream('deflate'), MAX_DECODED_BYTES)
    json = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes))
  } catch (err) {
    throw err instanceof DamagedLinkError ? err : new DamagedLinkError('corrupt')
  }
  const parsed = SharePayloadSchema.safeParse(json)
  if (!parsed.success) throw new DamagedLinkError('invalid contents')
  return parsed.data
}

export function shareUrl(encoded: string, location: Pick<Location, 'origin' | 'pathname'> = window.location): string {
  return `${location.origin}${location.pathname}${PREFIX}${encoded}`
}

/** The encoded part of a share link's hash, or undefined if the hash isn't one. */
export function readShareHash(hash: string): string | undefined {
  return hash.startsWith(PREFIX) ? hash.slice(PREFIX.length) : undefined
}

/** A shared link opens as a new local chat; "whole chat" answers show as finished. */
export function chatFromShare(payload: SharePayload, id: string, at: number): { chat: ChatState; draft?: string } {
  const columns = payload.columns.map(
    (col, c): Column => ({
      id: c === 0 ? 'col_a' : 'col_b',
      settings: col.settings,
      messages: (col.messages ?? []).map((m, i): Message => (m.role === 'user' ? { role: 'user', text: m.text } : sharedAnswer(m.text, col.settings, `${id}_${c}_${i}`, at))),
      ...(payload.proposal ? { proposed: { label: col.label ?? `Choice ${c + 1}`, ...(col.why ? { why: col.why } : {}), settings: col.settings } } : {}),
    }),
  )
  const hasMessages = columns.some((col) => col.messages.length > 0)
  return {
    // A chat with messages is saved straight away (rev 1); a setup is saved once it's run.
    chat: { id, createdAt: at, columns, sharedFrom: true, rev: hasMessages ? 1 : 0, ...(payload.proposal ? { proposal: payload.proposal } : {}) },
    ...(payload.draft ? { draft: payload.draft } : {}),
  }
}

function sharedAnswer(text: string, settings: SharePayload['columns'][number]['settings'], runId: string, at: number): AssistantMessage {
  return { role: 'assistant', runId, requestId: '', text, status: 'done', settingsUsed: settings, startedAt: at, attempts: [] }
}

/** Runs bytes through a compression stream, refusing output larger than `maxBytes`. */
async function transform(input: Uint8Array<ArrayBuffer>, stream: CompressionStream | DecompressionStream, maxBytes = Infinity): Promise<Uint8Array<ArrayBuffer>> {
  const reader = new Blob([input]).stream().pipeThrough(stream).getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    total += value.length
    if (total > maxBytes) {
      await reader.cancel()
      throw new DamagedLinkError('too large once decoded')
    }
    chunks.push(value)
  }
  const out = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    out.set(chunk, offset)
    offset += chunk.length
  }
  return out
}

function toBase64Url(bytes: Uint8Array): string {
  let binary = ''
  // In slices: spreading a large array into fromCharCode overflows the call stack.
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '')
}

function fromBase64Url(text: string): Uint8Array<ArrayBuffer> {
  if (!/^[A-Za-z0-9_-]*$/.test(text)) throw new DamagedLinkError('not base64url')
  // atob accepts missing padding, and throws on a length no base64 string can have.
  const binary = atob(text.replaceAll('-', '+').replaceAll('_', '/'))
  return Uint8Array.from(binary, (ch) => ch.charCodeAt(0))
}
