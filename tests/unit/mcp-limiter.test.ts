import { describe, expect, it } from 'vitest'
import { Limiter } from '../../src/server/mcp/complete'

describe('Limiter', () => {
  it('never runs more than its size at once, and runs everything in order', async () => {
    const limiter = new Limiter(2)
    let active = 0
    let most = 0
    const started: number[] = []
    const releases: (() => void)[] = []
    const tasks = [0, 1, 2, 3, 4].map((i) =>
      limiter.run(async () => {
        started.push(i)
        active++
        most = Math.max(most, active)
        await new Promise<void>((resolve) => releases.push(resolve))
        active--
        return i
      }),
    )

    // Release whatever is running until everything has run, checking as we go.
    while (started.length < 5 || active > 0) {
      await new Promise((resolve) => setTimeout(resolve, 0))
      releases.shift()?.()
    }
    expect(await Promise.all(tasks)).toEqual([0, 1, 2, 3, 4])
    expect(started).toEqual([0, 1, 2, 3, 4])
    expect(most).toBe(2)
  })
})
