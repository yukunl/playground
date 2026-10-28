/**
 * Fault switches for what the mock's `?_simulate` can't do: break a stream
 * partway through. Chosen with the `X-Fault` header, and only
 * when PLAYGROUND_FAULTS is on. Every log line records the active fault.
 *
 *   drop_after:N   close the stream after N tokens
 *   stall_after:N  stop sending after N tokens without closing (the stall timeout ends it)
 */
export type Fault = { kind: 'drop_after' | 'stall_after'; tokens: number; raw: string }

export function parseFault(raw: string | undefined, faultsEnabled: boolean): Fault | undefined {
  if (!faultsEnabled || !raw) return undefined
  const match = /^(drop_after|stall_after):(\d{1,5})$/.exec(raw.trim())
  return match ? { kind: match[1] as Fault['kind'], tokens: Number(match[2]), raw: match[0] } : undefined
}
