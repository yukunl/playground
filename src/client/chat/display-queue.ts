type DisplayClock = {
  now: () => number
  frame: (cb: () => void) => number
  cancelFrame: (id: number) => void
  shouldAnimate?: () => boolean
}

const WORDS_PER_SECOND = 30
const CATCH_UP_SECONDS = 2.5
const PARTIAL_WORD_WAIT_MS = 100
const words = new Intl.Segmenter(undefined, { granularity: 'word' })
const graphemes = new Intl.Segmenter(undefined, { granularity: 'grapheme' })

/** Receives text immediately; reveals words on a separate, paced animation clock. */
export function createDisplayQueue(emit: (text: string) => void, clock: DisplayClock) {
  let pending = ''
  let ended = false
  let cancelled = false
  let frame: number | undefined
  let credit = 1
  let lastTick = clock.now()
  let lastInput = lastTick
  let resolveDrained!: () => void
  const drained = new Promise<void>((resolve) => { resolveDrained = resolve })
  const animate = () => clock.shouldAnimate?.() ?? true

  const unschedule = () => {
    if (frame !== undefined) clock.cancelFrame(frame)
    frame = undefined
  }
  const schedule = () => {
    if (frame === undefined && pending && !cancelled) frame = clock.frame(tick)
  }
  const flush = () => {
    unschedule()
    const text = pending
    pending = ''
    credit = 0
    lastTick = clock.now()
    if (text && !cancelled) emit(text)
    if (ended) resolveDrained()
  }

  function tick() {
    frame = undefined
    if (cancelled) return
    if (!animate()) return flush()

    const now = clock.now()
    // Speed up a large backlog, but never dump it after a delayed/background frame.
    const rate = Math.max(WORDS_PER_SECOND, pending.length / 6 / CATCH_UP_SECONDS)
    credit = Math.min(8, credit + Math.max(0, Math.min(now - lastTick, 64)) * rate / 1000)
    lastTick = now
    if (credit >= 1) {
      const next = takeWords(pending, Math.floor(credit), ended || now - lastInput >= PARTIAL_WORD_WAIT_MS)
      if (next.text) {
        pending = pending.slice(next.text.length)
        credit -= Math.max(1, next.units)
        emit(next.text)
      }
    }
    if (ended && !pending) resolveDrained()
    else schedule()
  }

  return {
    push(text: string) {
      if (cancelled || ended || !text) return
      lastInput = clock.now()
      // Time spent waiting for the network does not earn a burst of display credit.
      if (!pending) {
        lastTick = lastInput
        credit = Math.min(credit, 1)
      }
      pending += text
      if (animate()) schedule()
      else flush()
    },
    /** A successful network response remains active until its last word is visible. */
    finish() {
      ended = true
      if (!pending) resolveDrained()
      else if (animate()) schedule()
      else flush()
      return drained
    },
    /** On failure, retain all text received before showing the error. */
    flush,
    /** Stop freezes the visible prefix and discards the unrevealed tail. */
    cancel() {
      cancelled = true
      ended = true
      pending = ''
      unschedule()
      resolveDrained()
    },
  }
}

function takeWords(text: string, limit: number, allowTail: boolean): { text: string; units: number } {
  let end = 0
  let units = 0
  for (const part of words.segment(text)) {
    const isWord = part.isWordLike || /\p{Extended_Pictographic}/u.test(part.segment)
    if (isWord) {
      if (units >= limit) break
      // Long identifiers/URLs still make progress without splitting a grapheme.
      if (part.segment.length > 48) {
        let count = 0
        for (const grapheme of graphemes.segment(part.segment)) {
          end = part.index + grapheme.index + grapheme.segment.length
          if (++count === 24) break
        }
        units++
        break
      }
      // Hold a trailing fragment briefly so chunks like "stream" + "ing " reveal as one word.
      if (part.index + part.segment.length === text.length && !allowTail) break
      units++
    }
    end = part.index + part.segment.length
  }
  return { text: text.slice(0, end), units }
}
