// @vitest-environment happy-dom
import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useModels } from '../../src/client/use-models'
import type { Model, ModelsResponse } from '../../src/shared/models'

const savedModel: Model = { id: 'saved-model', featured: false, pricing: null }
const freshModel: Model = { id: 'fresh-model', featured: false, pricing: null }
const timeoutError = {
  type: 'inference_unavailable',
  source: 'inference',
  retryable: true,
  requestId: 'req_timeout',
  details: { reason: 'timeout' },
  message: "The inference API didn't respond in time.",
}

const freshResponse = () => Response.json({
  data: [freshModel],
  fetchedAt: new Date().toISOString(),
  stale: false,
} satisfies ModelsResponse)
const timedOut = () => Response.json({ error: timeoutError }, { status: 504 })

beforeEach(() => {
  localStorage.clear()
  vi.useFakeTimers()
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('model-list recovery', () => {
  it('keeps saved models through a timeout, then refreshes and clears the error when the API recovers', async () => {
    localStorage.setItem('playground.models.v2', JSON.stringify({ models: [savedModel] }))
    const fetch = vi.fn().mockResolvedValueOnce(timedOut()).mockImplementation(freshResponse)
    vi.stubGlobal('fetch', fetch)

    const { result } = renderHook(() => useModels())
    await act(() => vi.advanceTimersByTimeAsync(0))
    expect(result.current.models).toEqual([savedModel])
    expect(result.current.refreshError?.message).toBe(timeoutError.message)

    await act(() => vi.advanceTimersByTimeAsync(10_000))
    expect(fetch).toHaveBeenCalledTimes(2)
    expect(result.current.models).toEqual([freshModel])
    expect(result.current.refreshError).toBeUndefined()
    expect(JSON.parse(localStorage.getItem('playground.models.v2')!).models).toEqual([freshModel])
  })

  it('replaces the saved list when the initial refresh succeeds', async () => {
    localStorage.setItem('playground.models.v2', JSON.stringify({ models: [savedModel] }))
    vi.stubGlobal('fetch', vi.fn().mockImplementation(freshResponse))

    const { result } = renderHook(() => useModels())
    await act(() => vi.advanceTimersByTimeAsync(0))

    expect(result.current.models).toEqual([freshModel])
    expect(result.current.refreshError).toBeUndefined()
  })

  it('recovers from a timeout when there is no saved model list', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(timedOut()).mockImplementation(freshResponse))

    const { result } = renderHook(() => useModels())
    await act(() => vi.advanceTimersByTimeAsync(0))
    expect(result.current.error?.message).toBe(timeoutError.message)

    await act(() => vi.advanceTimersByTimeAsync(10_000))
    expect(result.current.models).toEqual([freshModel])
    expect(result.current.error).toBeUndefined()
    expect(result.current.loading).toBe(false)
  })

  it('stops after three retries and lets the user try again without remounting', async () => {
    localStorage.setItem('playground.models.v2', JSON.stringify({ models: [savedModel] }))
    const fetch = vi.fn().mockImplementation(timedOut)
    vi.stubGlobal('fetch', fetch)

    const { result } = renderHook(() => useModels())
    await act(() => vi.advanceTimersByTimeAsync(10_000))
    expect(fetch).toHaveBeenCalledTimes(4)
    expect(result.current.models).toEqual([savedModel])
    expect(result.current.refreshError?.message).toBe(timeoutError.message)
    expect(result.current.refreshing).toBe(false)

    await act(() => vi.advanceTimersByTimeAsync(60_000))
    expect(fetch).toHaveBeenCalledTimes(4)

    fetch.mockImplementation(freshResponse)
    act(() => result.current.refresh())
    await act(() => vi.advanceTimersByTimeAsync(0))
    expect(fetch).toHaveBeenCalledTimes(5)
    expect(result.current.models).toEqual([freshModel])
    expect(result.current.refreshError).toBeUndefined()
    expect(result.current.refreshing).toBe(false)
  })

  it('does not automatically retry a non-retryable error', async () => {
    const error = { ...timeoutError, type: 'service_misconfigured', retryable: false }
    const fetch = vi.fn().mockImplementation(() => Response.json({ error }, { status: 502 }))
    vi.stubGlobal('fetch', fetch)

    const { result } = renderHook(() => useModels())
    await act(() => vi.advanceTimersByTimeAsync(10_000))
    expect(fetch).toHaveBeenCalledTimes(1)
    expect(result.current.error?.type).toBe('service_misconfigured')
    expect(result.current.refreshing).toBe(false)
  })

  it('honors Retry-After before refreshing the model list', async () => {
    const error = { ...timeoutError, type: 'rate_limited', retryAfterMs: 2000 }
    const fetch = vi.fn()
      .mockResolvedValueOnce(Response.json({ error }, { status: 429 }))
      .mockImplementation(freshResponse)
    vi.stubGlobal('fetch', fetch)

    const { result } = renderHook(() => useModels())
    await act(() => vi.advanceTimersByTimeAsync(0))
    await act(() => vi.advanceTimersByTimeAsync(1999))
    expect(fetch).toHaveBeenCalledTimes(1)
    await act(() => vi.advanceTimersByTimeAsync(1))
    expect(fetch).toHaveBeenCalledTimes(2)
    expect(result.current.models).toEqual([freshModel])
  })

  it('cancels scheduled retries when the hook unmounts', async () => {
    const fetch = vi.fn().mockImplementation(timedOut)
    vi.stubGlobal('fetch', fetch)

    const { unmount } = renderHook(() => useModels())
    await act(() => vi.advanceTimersByTimeAsync(0))
    unmount()
    await act(() => vi.advanceTimersByTimeAsync(10_000))

    expect(fetch).toHaveBeenCalledTimes(1)
  })

  it('aborts an in-flight refresh when the hook unmounts', () => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockImplementation(() => new Promise(() => {}))
    vi.stubGlobal('fetch', fetch)

    const { unmount } = renderHook(() => useModels())
    const signal = fetch.mock.calls[0]?.[1]?.signal
    expect(signal?.aborted).toBe(false)
    unmount()
    expect(signal?.aborted).toBe(true)
  })
})
