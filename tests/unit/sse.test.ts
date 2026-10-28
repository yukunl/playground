import { describe, expect, it } from 'vitest'
import { readSseData } from '../../src/shared/sse'

/** A byte stream that delivers `text` in the given chunk sizes. */
function streamOf(text: string, chunkSize = Infinity): ReadableStream<Uint8Array> {
  const bytes = new TextEncoder().encode(text)
  return new ReadableStream({
    start(controller) {
      for (let i = 0; i < bytes.length; i += chunkSize) controller.enqueue(bytes.slice(i, i + chunkSize))
      controller.close()
    },
  })
}

async function collect(stream: ReadableStream<Uint8Array>): Promise<string[]> {
  const out: string[] = []
  for await (const data of readSseData(stream)) out.push(data)
  return out
}

const SAMPLE = 'data: {"a":1}\n\n: ping\n\ndata: {"b":"héllo 🪂"}\n\ndata: [DONE]\n\n'

describe('readSseData', () => {
  it('yields each event’s data', async () => {
    expect(await collect(streamOf(SAMPLE))).toEqual(['{"a":1}', '{"b":"héllo 🪂"}', '[DONE]'])
  })

  it('gives the same result when bytes arrive one at a time (including split multi-byte characters)', async () => {
    expect(await collect(streamOf(SAMPLE, 1))).toEqual(['{"a":1}', '{"b":"héllo 🪂"}', '[DONE]'])
  })

  it('handles CRLF line endings, even split between chunks', async () => {
    const crlf = SAMPLE.replaceAll('\n', '\r\n')
    for (const size of [1, 2, 3, 7]) {
      expect(await collect(streamOf(crlf, size))).toEqual(['{"a":1}', '{"b":"héllo 🪂"}', '[DONE]'])
    }
  })

  it('joins multi-line data and ignores other fields', async () => {
    expect(await collect(streamOf('event: x\nid: 1\ndata: line one\ndata: line two\n\n'))).toEqual(['line one\nline two'])
  })

  it('drops an event cut off by the end of the stream', async () => {
    expect(await collect(streamOf('data: complete\n\ndata: cut off'))).toEqual(['complete'])
  })
})
