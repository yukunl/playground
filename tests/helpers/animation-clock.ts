/** Advances browser frames explicitly, independently of network microtasks. */
export function animationClock(start = 1000) {
  let now = start
  let id = 0
  const frames = new Map<number, () => void>()
  return {
    now: () => now,
    frame: (cb: () => void) => { frames.set(++id, cb); return id },
    cancelFrame: (frameId: number) => { frames.delete(frameId) },
    pendingFrames: () => frames.size,
    advance(ms = 16) {
      now += ms
      const callbacks = [...frames.values()]
      frames.clear()
      for (const cb of callbacks) cb()
    },
  }
}
