import { describe, expect, it } from 'vitest'
import { createDisplayQueue } from '../../src/client/chat/display-queue'
import { animationClock } from '../helpers/animation-clock'

function setup(shouldAnimate = () => true) {
  const clock = animationClock()
  const chunks: string[] = []
  const queue = createDisplayQueue((text) => chunks.push(text), { ...clock, shouldAnimate })
  const drain = () => {
    let frames = 0
    while (clock.pendingFrames() && frames++ < 2000) clock.advance()
    expect(clock.pendingFrames()).toBe(0)
  }
  return { clock, chunks, queue, drain, text: () => chunks.join('') }
}

describe('display queue', () => {
  it('reveals a response received all at once over multiple frames, including after finish', async () => {
    const q = setup()
    const answer = 'One two three four five six seven eight nine ten.'
    q.clock.advance(5000) // A long time to first token must not accelerate the first frame.
    q.queue.push(answer)
    let finished = false
    const done = q.queue.finish().then(() => { finished = true })
    expect(q.text()).toBe('')

    q.clock.advance()
    await Promise.resolve()
    expect(q.text()).toBe('One ')
    expect(finished).toBe(false)
    q.drain()
    await done
    expect(q.text()).toBe(answer)
    expect(q.chunks.length).toBeGreaterThan(5)
    expect(finished).toBe(true)
  })

  it('joins words split across network chunks and allows an idle fragment to progress', () => {
    const q = setup()
    q.queue.push('stream')
    q.clock.advance()
    expect(q.text()).toBe('')
    q.queue.push('ing ')
    q.clock.advance()
    expect(q.text()).toBe('streaming ')

    q.queue.push('next')
    q.clock.advance(50)
    expect(q.text()).toBe('streaming ')
    q.clock.advance(50)
    expect(q.text()).toBe('streaming next')
  })

  it('preserves markdown, whitespace, Unicode words and emoji exactly', async () => {
    const q = setup()
    const chunks = ['## Hé', 'llo 👩🏽‍💻!\n\n', '**世界**\t', '你好\n\n```ts\n', 'const café = "e\u0301";\n```\n']
    for (const chunk of chunks) {
      q.queue.push(chunk)
      q.clock.advance()
    }
    const done = q.queue.finish()
    q.drain()
    await done
    expect(q.text()).toBe(chunks.join(''))
    expect(q.chunks.filter((chunk) => chunk.includes('👩'))).toEqual([expect.stringContaining('👩🏽‍💻')])
  })

  it('makes gradual progress through a long identifier without splitting combining characters', async () => {
    const q = setup()
    const identifier = 'e\u0301'.repeat(100)
    q.queue.push(identifier)
    const done = q.queue.finish()
    q.clock.advance()
    expect(q.text().length).toBeGreaterThan(0)
    expect(q.text().length).toBeLessThan(identifier.length)
    q.drain()
    await done
    expect(q.text()).toBe(identifier)
    expect(q.chunks.every((chunk) => chunk.endsWith('\u0301'))).toBe(true)
  })

  it('catches up a large backlog without dumping it after a delayed frame', async () => {
    const q = setup()
    const answer = 'word '.repeat(1000)
    q.queue.push(answer)
    const done = q.queue.finish()
    q.clock.advance(10_000)
    expect(q.text().split(' ').filter(Boolean).length).toBeLessThanOrEqual(8)
    const started = q.clock.now()
    q.drain()
    await done
    expect(q.text()).toBe(answer)
    // A fixed 30 words/sec would leave this response animating for over 30 seconds.
    expect(q.clock.now() - started).toBeLessThan(15_000)
  })

  it('Stop freezes the visible prefix and releases a pending finish', async () => {
    const q = setup()
    q.queue.push('One two three four five.')
    const done = q.queue.finish()
    q.clock.advance()
    const visible = q.text()
    q.queue.cancel()
    await done
    q.clock.advance(1000)
    q.queue.push(' late text')
    expect(visible).toBe('One ')
    expect(q.text()).toBe(visible)
    expect(q.clock.pendingFrames()).toBe(0)
  })

  it('flush exposes all received text once and cancels the pending frame', () => {
    const q = setup()
    q.queue.push('Text received before a failure')
    q.queue.flush()
    q.clock.advance()
    q.queue.flush()
    expect(q.chunks).toEqual(['Text received before a failure'])
    expect(q.clock.pendingFrames()).toBe(0)
  })

  it('shows text immediately when animation is disabled, including a preference change', async () => {
    let animate = true
    const q = setup(() => animate)
    q.queue.push('Already queued ')
    animate = false
    q.clock.advance()
    expect(q.text()).toBe('Already queued ')
    q.queue.push('new text')
    await q.queue.finish()
    expect(q.text()).toBe('Already queued new text')
    expect(q.clock.pendingFrames()).toBe(0)
  })

  it('finishes an empty response without scheduling any frames', async () => {
    const q = setup()
    await q.queue.finish()
    q.queue.push('too late')
    expect(q.text()).toBe('')
    expect(q.clock.pendingFrames()).toBe(0)
  })
})
