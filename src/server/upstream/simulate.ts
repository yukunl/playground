/**
 * Reads `?_simulate=N` the way the mock does: any value turns it on, and a value
 * that isn't an error status becomes 500. Ignored unless PLAYGROUND_FAULTS is on.
 */
export function parseSimulate(raw: string | undefined, faultsEnabled: boolean): number | undefined {
  if (!faultsEnabled || raw === undefined || raw === '') return undefined
  const status = Number(raw)
  return Number.isInteger(status) && status >= 400 && status <= 599 ? status : 500
}
