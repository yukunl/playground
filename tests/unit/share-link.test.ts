import { describe, expect, it } from 'vitest'
import { chatReducer, duplicateColumn, initialChat } from '../../src/client/chat/reducer'
import type { ChatState } from '../../src/client/chat/types'
import { chatFromShare, decodeShare, encodeShare, readShareHash, sharePayload, shareUrl, type SharePayload } from '../../src/client/share/share-link'

function chat(): ChatState {
  let s = chatReducer(initialChat('chat_1', 1000), { type: 'updateSettings', columnId: 'col_a', patch: { model: 'm', system: 'Be brief.', temperature: 0.2, stop: ['###'] } })
  s = chatReducer(s, { type: 'send', columnId: 'col_a', text: 'first question', runId: 'run_1', requestId: 'req_1', at: 1000 })
  s = chatReducer(s, { type: 'tokens', runId: 'run_1', text: 'first answer', at: 1100 })
  s = chatReducer(s, { type: 'done', runId: 'run_1', finishReason: 'stop', costUsd: 0.01, at: 1200 })
  // A failed run with no text adds nothing to the link.
  s = chatReducer(s, { type: 'send', columnId: 'col_a', text: 'second question', runId: 'run_2', requestId: 'req_2', at: 2000 })
  return chatReducer(s, { type: 'failed', runId: 'run_2', at: 2100, error: { type: 'inference_unavailable', source: 'inference', retryable: true, message: 'busy', requestId: 'req_2' } })
}

/** Encodes arbitrary bytes the way a link would carry them, for links we'd never make. */
async function rawLink(text: string): Promise<string> {
  const compressed = new Uint8Array(await new Response(new Blob([text]).stream().pipeThrough(new CompressionStream('deflate'))).arrayBuffer())
  return btoa(String.fromCharCode(...compressed)).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '')
}

describe('share payload', () => {
  it('"just the setup" carries the settings and the draft, and no messages', () => {
    const p = sharePayload(chat(), 'setup', 'my draft')
    expect(p).toEqual({ v: 1, mode: 'setup', columns: [{ settings: chat().columns[0]!.settings }], draft: 'my draft' })
  })

  it('"whole chat" carries every message with text, and nothing else about the runs', () => {
    const p = sharePayload(chat(), 'chat', 'ignored draft')
    expect(p.columns[0]!.messages).toEqual([
      { role: 'user', text: 'first question' },
      { role: 'assistant', text: 'first answer' },
      { role: 'user', text: 'second question' },
    ])
    expect(p.draft).toBeUndefined()
    expect(JSON.stringify(p)).not.toMatch(/run_|req_|costUsd|attempts/)
  })
})

describe('encoding', () => {
  it('round-trips both modes through deflate and base64url', async () => {
    for (const mode of ['setup', 'chat'] as const) {
      const payload = sharePayload(chat(), mode, 'draft ✈️ with emoji')
      const encoded = await encodeShare(payload)
      expect(encoded).toMatch(/^[A-Za-z0-9_-]+$/)
      expect(await decodeShare(encoded)).toEqual(payload)
    }
  })

  it('keeps a setup with a long system prompt well under the 8,000-character warning', async () => {
    const s = chatReducer(chat(), { type: 'updateSettings', columnId: 'col_a', patch: { system: 'You are a support agent. Answer in two sentences. '.repeat(40) } })
    expect((await encodeShare(sharePayload(s, 'setup', ''))).length).toBeLessThan(1_000)
  })

  it('builds the URL with the payload after #s=, and reads it back', () => {
    const url = shareUrl('abc', { origin: 'https://playground.example', pathname: '/' })
    expect(url).toBe('https://playground.example/#s=abc')
    expect(readShareHash(new URL(url).hash)).toBe('abc')
    expect(readShareHash('#other')).toBeUndefined()
  })
})

describe('damaged links fail cleanly', () => {
  it('a link cut off anywhere is refused', async () => {
    const encoded = await encodeShare(sharePayload(chat(), 'chat', ''))
    for (const keep of [1, 10, Math.floor(encoded.length / 2), encoded.length - 5, encoded.length - 1]) {
      await expect(decodeShare(encoded.slice(0, keep)), `kept ${keep} of ${encoded.length}`).rejects.toThrow(/Damaged share link/)
    }
  })

  it('an edited character is refused', async () => {
    const encoded = await encodeShare(sharePayload(chat(), 'chat', ''))
    for (let at = 4; at < encoded.length; at += 7) {
      const flipped = encoded.slice(0, at) + (encoded[at] === 'A' ? 'B' : 'A') + encoded.slice(at + 1)
      await expect(decodeShare(flipped), `edited at ${at}`).rejects.toThrow(/Damaged share link/)
    }
  })

  it('characters base64url never uses are refused', async () => {
    await expect(decodeShare('abc$def')).rejects.toMatchObject({ reason: 'not base64url' })
  })

  it('a link longer than we would ever make is refused before decoding', async () => {
    await expect(decodeShare('A'.repeat(100_001))).rejects.toMatchObject({ reason: 'too long' })
  })

  it('a small link that decompresses to megabytes is stopped part way', async () => {
    const bomb = await rawLink(`{"v":1,"mode":"setup","draft":"${' '.repeat(5_000_000)}"}`)
    expect(bomb.length).toBeLessThan(100_000)
    await expect(decodeShare(bomb)).rejects.toMatchObject({ reason: 'too large once decoded' })
  })

  it('valid JSON that breaks the schema is refused (a link is untrusted input)', async () => {
    const settings = { ...chat().columns[0]!.settings, temperature: 5 }
    await expect(decodeShare(await rawLink(JSON.stringify({ v: 1, mode: 'setup', columns: [{ settings }] })))).rejects.toMatchObject({ reason: 'invalid contents' })
    await expect(decodeShare(await rawLink('{"v":1,"mode":"setup","columns":[]}'))).rejects.toMatchObject({ reason: 'invalid contents' })
    await expect(decodeShare(await rawLink('not json'))).rejects.toMatchObject({ reason: 'corrupt' })
  })
})

describe('opening a link', () => {
  it('"whole chat" becomes a new local chat with finished answers, saved straight away', () => {
    const payload = sharePayload(chat(), 'chat', '')
    const { chat: opened, draft } = chatFromShare(payload, 'chat_new', 9000)
    expect(opened).toMatchObject({ id: 'chat_new', createdAt: 9000, sharedFrom: true, rev: 1 })
    expect(draft).toBeUndefined()
    const messages = opened.columns[0]!.messages
    expect(messages.map((m) => m.text)).toEqual(['first question', 'first answer', 'second question'])
    expect(messages[1]).toMatchObject({ role: 'assistant', status: 'done', settingsUsed: { model: 'm', temperature: 0.2 } })
  })

  it('a compare chat shares both columns and opens as compare again', async () => {
    let s = chat()
    s = chatReducer(s, { type: 'addColumn', column: { ...duplicateColumn(s.columns[0]!, 'col_b'), settings: { ...s.columns[0]!.settings, temperature: 1.2 } } })
    const payload = await decodeShare(await encodeShare(sharePayload(s, 'chat', '')))
    const opened = chatFromShare(payload, 'chat_new', 9000).chat
    expect(opened.columns.map((c) => [c.id, c.settings.temperature, c.messages.length])).toEqual([
      ['col_a', 0.2, 3],
      ['col_b', 1.2, 3],
    ])
  })

  it('"just the setup" fills in the settings and the draft, and waits to be run before it is saved', () => {
    const payload: SharePayload = sharePayload(chat(), 'setup', 'try this')
    const { chat: opened, draft } = chatFromShare(payload, 'chat_new', 9000)
    expect(opened.rev).toBe(0)
    expect(opened.columns[0]).toMatchObject({ settings: { system: 'Be brief.', stop: ['###'] }, messages: [] })
    expect(draft).toBe('try this')
  })
})
