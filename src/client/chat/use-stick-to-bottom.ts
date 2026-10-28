import { useCallback, useEffect, useRef, useState } from 'react'

const NEAR_BOTTOM_PX = 48

/**
 * Follows new content only while you're at the bottom. Scroll up to read and it
 * stops dragging you down; `jumpToLatest` brings you back.
 */
export function useStickToBottom<T extends HTMLElement>(contentKey: unknown) {
  const ref = useRef<T>(null)
  const [stuck, setStuck] = useState(true)

  const onScroll = useCallback(() => {
    const el = ref.current
    if (el) setStuck(el.scrollHeight - el.scrollTop - el.clientHeight < NEAR_BOTTOM_PX)
  }, [])

  useEffect(() => {
    const el = ref.current
    if (el && stuck) el.scrollTop = el.scrollHeight
  }, [contentKey, stuck])

  const jumpToLatest = useCallback(() => {
    const el = ref.current
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' })
    setStuck(true)
  }, [])

  return { ref, onScroll, stuck, jumpToLatest }
}
