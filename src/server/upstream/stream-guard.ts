// Timers that keep a stream from hanging without ever erroring.

export type StreamTimings = {
  /** No first token within this long (from sending the request) → abort, and retry. */
  firstTokenMs: number
  /** Tokens were arriving, then nothing for this long → abort, stream_interrupted. */
  stallMs: number
  /** How often to send `: ping` so proxies keep a quiet connection open. */
  heartbeatMs: number
}

export const DEFAULT_TIMINGS: StreamTimings = { firstTokenMs: 30_000, stallMs: 20_000, heartbeatMs: 15_000 }

/** Why we aborted the upstream call ourselves. */
export class StreamTimeout extends Error {
  constructor(readonly phase: 'first_token' | 'stall') {
    super(`Upstream ${phase === 'first_token' ? 'first-token' : 'stall'} timeout`)
    this.name = 'TimeoutError'
  }
}
export class BrowserLeft extends Error {
  constructor() {
    super('The browser closed the stream')
  }
}
export class FaultDrop extends Error {
  constructor() {
    super('Fault switch: drop the stream')
  }
}

/** Aborts `controller` if it isn't re-armed in time. Re-arm on every token. */
export class Watchdog {
  private timer: ReturnType<typeof setTimeout> | undefined

  constructor(private readonly controller: AbortController) {}

  arm(ms: number, phase: StreamTimeout['phase']): void {
    clearTimeout(this.timer)
    this.timer = setTimeout(() => this.controller.abort(new StreamTimeout(phase)), ms)
  }

  stop(): void {
    clearTimeout(this.timer)
  }
}

export function untilAborted(signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.resolve()
  return new Promise((resolve) => signal.addEventListener('abort', () => resolve(), { once: true }))
}
