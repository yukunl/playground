import { useEffect, useState } from 'react'
import type { Health } from '../shared/models'
import { getJson } from './api'

/** The server's version, which upstream it talks to, and whether fault switches are on. */
export function useHealth(): Health | null {
  const [health, setHealth] = useState<Health | null>(null)
  useEffect(() => {
    let cancelled = false
    getJson<Health>('/api/health').then(
      (h) => !cancelled && setHealth(h),
      () => {},
    )
    return () => {
      cancelled = true
    }
  }, [])
  return health
}
