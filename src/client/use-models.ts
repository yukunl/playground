import { useCallback, useEffect, useState } from 'react'
import type { ApiError } from '../shared/api-error'
import type { Model, ModelsResponse } from '../shared/models'
import { ApiRequestError, getJson } from './api'
import { nextRetryDelay } from './chat/retry'
import { readStorage, removeStorage, writeStorage } from './storage'

/** The mock's flagship, used when no model is featured (the mock matches nothing in our table). */
const MOCK_DEFAULT = 'parasail-llama-3.1-70b-instruct'
const LAST_MODEL_KEY = 'playground.lastModel'
const MODELS_KEY = 'playground.models.v2'

export type ModelsState = {
  models: Model[]
  /** When the table's list prices were copied, if any model uses them. */
  pricesAsOf?: string
  loading: boolean
  /** A refresh is in flight or waiting for an automatic retry. */
  refreshing: boolean
  /** Couldn't load the list at all. */
  error?: ApiError
  /** Couldn't refresh it, so the saved copy is in use. */
  refreshError?: ApiError
}

type Saved = { models: Model[]; pricesAsOf?: string }

/**
 * Shows the saved list right away and refreshes it in the background: the
 * mock adds 50–300 ms to every request, and the input box never waits for it.
 * Transient failures use the same bounded retry policy as chat. A manual
 * refresh starts a new attempt sequence without resetting the conversation.
 */
export function useModels(): ModelsState & { refresh: () => void } {
  const [state, setState] = useState<ModelsState>(() => {
    const saved = readSaved()
    return saved ? { ...saved, loading: false, refreshing: true } : { models: [], loading: true, refreshing: true }
  })
  const [refreshVersion, setRefreshVersion] = useState(0)
  const refresh = useCallback(() => setRefreshVersion((version) => version + 1), [])

  useEffect(() => {
    let cancelled = false
    let retries = 0
    let waited = 0
    let timer: ReturnType<typeof setTimeout> | undefined
    const controller = new AbortController()

    const load = async () => {
      try {
        const res = await getJson<ModelsResponse>('/api/models', controller.signal)
        if (cancelled) return
        const fresh: Saved = { models: res.data, ...(res.pricesAsOf ? { pricesAsOf: res.pricesAsOf } : {}) }
        setState({ ...fresh, loading: false, refreshing: false })
        writeStorage(MODELS_KEY, JSON.stringify(fresh))
        removeStorage('playground.models') // the format before the model table
      } catch (err) {
        if (cancelled) return
        const error = err instanceof ApiRequestError ? err.error : undefined
        const delay = error ? nextRetryDelay(error, retries, waited) : null
        setState((prev) =>
          prev.models.length > 0
            ? { ...prev, loading: false, refreshing: delay !== null, refreshError: error }
            : { models: [], loading: false, refreshing: delay !== null, error },
        )
        if (delay !== null) {
          retries++
          waited += delay
          timer = setTimeout(() => void load(), delay)
        }
      }
    }

    setState((prev) => ({ ...prev, loading: prev.models.length === 0, refreshing: true }))
    void load()
    return () => {
      cancelled = true
      clearTimeout(timer)
      controller.abort()
    }
  }, [refreshVersion])

  return { ...state, refresh }
}

/**
 * The last model used, if it's still listed. Otherwise the first featured model
 * (the first answer is the sales pitch), then the mock's flagship, then the first.
 */
export function defaultModel(models: Model[]): string {
  const last = readStorage(LAST_MODEL_KEY)
  if (last && models.some((m) => m.id === last)) return last
  return (
    models.find((m) => m.featured)?.id ?? models.find((m) => m.id === MOCK_DEFAULT)?.id ?? models[0]?.id ?? ''
  )
}

export function rememberModel(id: string): void {
  writeStorage(LAST_MODEL_KEY, id)
}

function readSaved(): Saved | null {
  try {
    const parsed = JSON.parse(readStorage(MODELS_KEY) ?? 'null') as Partial<Saved> | null
    // Saved data can be old or edited by hand: keep it only if it still looks like a model list.
    const models = parsed?.models
    if (!Array.isArray(models) || models.length === 0 || !models.every((m) => typeof m?.id === 'string')) return null
    return { models: models.map((m) => ({ ...m, featured: Boolean(m.featured) })), ...(parsed?.pricesAsOf ? { pricesAsOf: parsed.pricesAsOf } : {}) }
  } catch {
    return null
  }
}
