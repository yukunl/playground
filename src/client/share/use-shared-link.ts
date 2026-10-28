import { useEffect, useRef } from 'react'
import { decodeShare, readShareHash, type SharePayload } from './share-link'

/** Whether the page was opened with a share link (read before anything clears it). */
export const OPENED_WITH_SHARE_LINK = readShareHash(window.location.hash) !== undefined

type Handlers = {
  onOpen: (payload: SharePayload) => void
  onDamaged: () => void
}

/**
 * Opens a share link: on page load, and when a link is pasted into the address bar
 * of a tab that's already open (only the hash changes, so there's no reload). The
 * `#s=…` part is cleared straight away, so a refresh doesn't open it twice.
 */
export function useSharedLink(handlers: Handlers) {
  const latest = useRef(handlers)
  latest.current = handlers

  useEffect(() => {
    const check = () => {
      const encoded = readShareHash(window.location.hash)
      if (encoded === undefined) return
      history.replaceState(history.state, '', window.location.pathname + window.location.search)
      decodeShare(encoded).then(
        (payload) => latest.current.onOpen(payload),
        () => latest.current.onDamaged(),
      )
    }
    check()
    window.addEventListener('hashchange', check)
    return () => window.removeEventListener('hashchange', check)
  }, [])
}
