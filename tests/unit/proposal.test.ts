// An agent's proposal, carried by a setup link (docs/agent-handoff.md).
import { deflateSync } from 'node:zlib'
import { describe, expect, it } from 'vitest'
import { linkFor, payloadFromJson } from '../../scripts/share-link'
import { chatReducer, duplicateColumn } from '../../src/client/chat/reducer'
import type { ChatState } from '../../src/client/chat/types'
import { fromStored, readStoredChat, summarize, toStored } from '../../src/client/history/stored-chat'
import {
  changedSinceProposed,
  chatFromShare,
  decodeShare,
  DamagedLinkError,
  encodeShare,
  keepsProposal,
  readShareHash,
  sharePayload,
  type SharePayload,
} from '../../src/client/share/share-link'
import { DEFAULT_SETTINGS } from '../../src/shared/chat'

const consistent = { ...DEFAULT_SETTINGS, model: 'big', system: 'Scheduling only.', temperature: 0.2, seed: 7 }
const warmer = { ...DEFAULT_SETTINGS, model: 'small', system: 'Scheduling only. Be warm.', temperature: 0.8 }

const proposal: SharePayload = {
  v: 1,
  mode: 'setup',
  proposal: { by: 'Codex', title: 'Hospital scheduling assistant', summary: 'Tested on 6 requests.' },
  columns: [
    { label: 'Consistent', why: 'Same reply every time.', settings: consistent },
    { label: 'Warmer', settings: warmer },
  ],
  draft: 'Can I move my MRI to Friday?',
}

const opened = (): ChatState => chatFromShare(proposal, 'chat_p', 9000).chat

describe('proposal links', () => {
  it('round-trip, and open with each choice’s name, reason and proposed settings', async () => {
    const decoded = await decodeShare(await encodeShare(proposal))
    expect(decoded).toEqual(proposal)
    const { chat, draft } = chatFromShare(decoded, 'chat_p', 9000)
    expect(draft).toBe('Can I move my MRI to Friday?')
    expect(chat).toMatchObject({ sharedFrom: true, rev: 0, proposal: { by: 'Codex', title: 'Hospital scheduling assistant' } })
    expect(chat.columns.map((c) => c.proposed)).toEqual([
      { label: 'Consistent', why: 'Same reply every time.', settings: consistent },
      { label: 'Warmer', settings: warmer },
    ])
  })

  it('never carry answers, and labels never come without a proposal', async () => {
    const refused = [
      { ...proposal, mode: 'chat' },
      { ...proposal, columns: [{ ...proposal.columns[0]!, messages: [{ role: 'assistant', text: 'Trust me.' }] }] },
      { ...proposal, proposal: undefined },
      { ...proposal, proposal: { by: 'Codex', title: 'x'.repeat(121) } },
    ]
    for (const payload of refused) {
      await expect(decodeShare(await encodeShare(payload as SharePayload))).rejects.toBeInstanceOf(DamagedLinkError)
    }
  })
})

describe('sharing a proposal on', () => {
  it('a setup link keeps it while the choices are as proposed', () => {
    const chat = opened()
    expect(keepsProposal(chat)).toBe(true)
    expect(sharePayload(chat, 'setup', 'Can I move my MRI to Friday?')).toEqual(proposal)
  })

  it('an edit is shown on the column and leaves the proposal out of the next link', () => {
    const chat = chatReducer(opened(), { type: 'updateSettings', columnId: 'col_b', patch: { temperature: 1.1 } })
    expect(changedSinceProposed(chat.columns[1]!)).toEqual(['temperature'])
    expect(keepsProposal(chat)).toBe(false)
    const p = sharePayload(chat, 'setup', '')
    expect(p.proposal).toBeUndefined()
    expect(p.columns.map((c) => c.label)).toEqual([undefined, undefined])
  })

  it('a whole-chat link leaves it out', () => {
    let chat = opened()
    chat = chatReducer(chat, { type: 'send', columnId: 'col_a', text: 'q', runId: 'r', requestId: 'q', at: 1 })
    const p = sharePayload(chat, 'chat', '')
    expect(p.proposal).toBeUndefined()
    expect(JSON.stringify(p)).not.toMatch(/Consistent|Codex/)
  })
})

describe('a proposal in the chat', () => {
  it('a new chat keeps it, so the same choices can take another question', () => {
    const chat = chatReducer(opened(), { type: 'newChat', id: 'chat_2', at: 10_000 })
    expect(chat.proposal?.by).toBe('Codex')
    expect(chat.columns.map((c) => c.proposed?.label)).toEqual(['Consistent', 'Warmer'])
  })

  it('removing it keeps the settings and drops the names', () => {
    const chat = chatReducer(opened(), { type: 'clearProposal' })
    expect(chat.proposal).toBeUndefined()
    expect(chat.columns.map((c) => [c.settings.model, c.proposed])).toEqual([
      ['big', undefined],
      ['small', undefined],
    ])
    expect(chat.rev).toBe(1)
  })

  it('a copy made by Compare isn’t passed off as a proposed choice', () => {
    expect(duplicateColumn(opened().columns[0]!, 'col_b').proposed).toBeUndefined()
  })

  it('is saved to history and comes back', () => {
    const chat = chatReducer(opened(), { type: 'send', columnId: 'col_a', text: 'Can I move my MRI?', runId: 'r', requestId: 'q', at: 1 })
    const saved = toStored(chat, 5000)
    expect(readStoredChat(structuredClone(saved))).toEqual(saved)
    expect(fromStored(saved)).toMatchObject({ proposal: chat.proposal, columns: [{ proposed: { label: 'Consistent' } }, { proposed: { label: 'Warmer' } }] })
    expect(summarize(saved)).toMatchObject({ proposal: true, sharedFrom: true })
  })
})

describe('the share-link script', () => {
  it('fills in the version, the mode and default settings', () => {
    const p = payloadFromJson({ proposal: { by: 'Codex', title: 'T' }, columns: [{ label: 'One', settings: { model: 'big', temperature: 0.2 } }] })
    expect(p).toEqual({ v: 1, mode: 'setup', proposal: { by: 'Codex', title: 'T' }, columns: [{ label: 'One', settings: { ...DEFAULT_SETTINGS, model: 'big', temperature: 0.2 } }] })
  })

  it('names every problem in words', () => {
    expect(() => payloadFromJson({ proposal: { by: 'Codex', title: 'T' }, columns: [{ settings: { model: '', temperature: 5 } }] })).toThrow(
      /Pick a model[\s\S]*Temperature must be between 0 and 2/,
    )
  })

  it('prints a link the page opens', async () => {
    const link = await linkFor(proposal, 'https://playground.example/')
    expect(link.startsWith('https://playground.example/#s=')).toBe(true)
    expect(await decodeShare(readShareHash(new URL(link).hash)!)).toEqual(proposal)
  })

  it('the recipe in the handoff doc (zlib, then base64url without padding) makes links the page opens', async () => {
    const encoded = deflateSync(JSON.stringify(proposal)).toString('base64url')
    expect(await decodeShare(encoded)).toEqual(proposal)
  })
})
