/**
 * Yields the `data:` payload of each server-sent event in a byte stream, however
 * the network split the bytes. Used for both the upstream's stream (in the BFF)
 * and ours (in the browser).
 *
 * Comment lines (`: ping`) and other fields (`event:`, `id:`) are skipped. An
 * event cut off by the end of the stream is dropped, as the SSE spec says.
 */
export async function* readSseData(body: ReadableStream<Uint8Array>): AsyncGenerator<string> {
  const reader = body.getReader()
  const decoder = new TextDecoder() // `stream: true` below keeps multi-byte characters split across chunks intact
  let pending = '' // a line that hasn't ended yet
  let dataLines: string[] = []

  try {
    while (true) {
      const { value, done } = await reader.read()
      if (done) return

      let text = pending + decoder.decode(value, { stream: true })
      // A chunk ending in "\r" may be the first half of "\r\n": wait for the next chunk.
      let carry = ''
      if (text.endsWith('\r')) {
        carry = '\r'
        text = text.slice(0, -1)
      }
      const lines = text.split(/\r\n|\n|\r/)
      pending = lines.pop()! + carry

      for (const line of lines) {
        if (line === '') {
          if (dataLines.length > 0) yield dataLines.join('\n')
          dataLines = []
        } else if (line.startsWith('data:')) {
          dataLines.push(line.slice(5).replace(/^ /, ''))
        }
        // Lines starting with ":" are comments (heartbeats); other fields aren't used.
      }
    }
  } finally {
    // Stops the underlying stream if the caller stops reading early.
    reader.cancel().catch(() => {})
  }
}
