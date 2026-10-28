// @vitest-environment happy-dom
import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { RunArgs } from '../../src/client/chat/run-stream'
import type { ChatAction } from '../../src/client/chat/reducer'

// Runs are faked: each startRun call is recorded, and the test decides how it ends.
type FakeRun = { args: RunArgs; dispatch: (action: ChatAction) => void; cancel: ReturnType<typeof vi.fn> }
const runs: FakeRun[] = []
vi.mock('../../src/client/chat/run-stream', () => ({
  startRun: (args: RunArgs, dispatch: (action: ChatAction) => void) => {
    const run = { args, dispatch, cancel: vi.fn() }
    runs.push(run)
    return { cancel: run.cancel }
  },
}))

const { useChat } = await import('../../src/client/chat/use-chat')

function finish(run: FakeRun, text: string) {
  run.dispatch({ type: 'tokens', runId: run.args.runId, text, at: 1 })
  run.dispatch({ type: 'done', runId: run.args.runId, finishReason: 'stop', costUsd: null, at: 2 })
}

/** A chat in compare, with B at a different temperature. */
function comparing() {
  const hook = renderHook(() => useChat())
  act(() => hook.result.current.updateSettings('col_a', { model: 'm' }))
  act(() => hook.result.current.startCompare())
  act(() => hook.result.current.updateSettings('col_b', { temperature: 0.2 }))
  return hook
}

beforeEach(() => {
  runs.length = 0
})
afterEach(cleanup)

describe('compare', () => {
  it('B starts as a copy of A: same settings, same history', () => {
    const hook = renderHook(() => useChat())
    act(() => hook.result.current.updateSettings('col_a', { model: 'm', system: 'Be brief.' }))
    act(() => hook.result.current.send('hi'))
    act(() => finish(runs[0]!, 'hello'))
    act(() => hook.result.current.startCompare())

    const [a, b] = hook.result.current.state.columns
    expect(b).toMatchObject({ id: 'col_b', settings: a!.settings })
    expect(b!.messages.map((m) => m.text)).toEqual(['hi', 'hello'])
  })

  it('one message goes to both columns, each with its own settings and its own run', () => {
    const hook = comparing()
    act(() => hook.result.current.send('Explain caching'))

    expect(runs).toHaveLength(2)
    expect(runs.map((r) => r.args.request.settings.temperature)).toEqual([0.7, 0.2])
    expect(new Set(runs.map((r) => r.args.runId)).size).toBe(2)
    expect(runs.every((r) => r.args.request.messages.at(-1)?.content === 'Explain caching')).toBe(true)
    expect(hook.result.current.isStreaming).toBe(true)
  })

  it('each column sends only its own history', () => {
    const hook = comparing()
    act(() => hook.result.current.send('first'))
    act(() => finish(runs[0]!, 'answer from A'))
    act(() => finish(runs[1]!, 'answer from B'))
    act(() => hook.result.current.send('second'))

    expect(runs[2]!.args.request.messages.map((m) => m.content)).toEqual(['first', 'answer from A', 'second'])
    expect(runs[3]!.args.request.messages.map((m) => m.content)).toEqual(['first', 'answer from B', 'second'])
  })

  it('Stop on one column stops only that column; Esc (no column) stops both', () => {
    const hook = comparing()
    act(() => hook.result.current.send('hi'))
    act(() => hook.result.current.stop('col_b'))
    expect(runs[0]!.cancel).not.toHaveBeenCalled()
    expect(runs[1]!.cancel).toHaveBeenCalledOnce()

    act(() => hook.result.current.stop())
    expect(runs[0]!.cancel).toHaveBeenCalledOnce()
  })

  it('running one column again leaves the other alone', () => {
    const hook = comparing()
    act(() => hook.result.current.send('hi'))
    act(() => finish(runs[0]!, 'a'))
    act(() => finish(runs[1]!, 'b'))
    act(() => hook.result.current.runAgain('col_b'))

    expect(runs).toHaveLength(3)
    expect(runs[2]!.args.request.settings.temperature).toBe(0.2)
    const [a, b] = hook.result.current.state.columns
    expect(a!.messages[1]).toMatchObject({ text: 'a', status: 'done' })
    expect(b!.messages[1]).toMatchObject({ text: '', status: 'streaming' })
  })

  it('closing B stops only its run and leaves A', () => {
    const hook = comparing()
    act(() => hook.result.current.send('hi'))
    act(() => hook.result.current.closeColumn('col_b'))

    expect(runs[1]!.cancel).toHaveBeenCalledOnce()
    expect(runs[0]!.cancel).not.toHaveBeenCalled()
    expect(hook.result.current.state.columns.map((c) => c.id)).toEqual(['col_a'])
  })

  it('closing A keeps B, and a new panel after that gets a free ID', () => {
    const hook = comparing()
    act(() => hook.result.current.closeColumn('col_a'))
    expect(hook.result.current.state.columns.map((c) => c.id)).toEqual(['col_b'])

    act(() => hook.result.current.startCompare())
    expect(hook.result.current.state.columns.map((c) => c.id)).toEqual(['col_b', 'col_a'])
  })

  it("can't start while an answer is streaming", () => {
    const hook = renderHook(() => useChat())
    act(() => hook.result.current.updateSettings('col_a', { model: 'm' }))
    act(() => hook.result.current.send('hi'))
    act(() => hook.result.current.startCompare())
    expect(hook.result.current.state.columns).toHaveLength(1)
  })
})

describe('leaving a chat mid-answer', () => {
  function streaming() {
    const hook = renderHook(() => useChat())
    act(() => hook.result.current.updateSettings('col_a', { model: 'm' }))
    act(() => hook.result.current.send('hi'))
    return hook
  }

  it('New chat lets the answer finish in the background', () => {
    const hook = streaming()
    const firstId = hook.result.current.state.id
    act(() => hook.result.current.newChat())

    expect(runs[0]!.cancel).not.toHaveBeenCalled()
    expect(hook.result.current.state.id).not.toBe(firstId)
    expect(hook.result.current.state.columns[0]!.messages).toEqual([])
    expect(hook.result.current.background.map((c) => c.id)).toEqual([firstId])

    act(() => finish(runs[0]!, 'hello'))
    const [left] = hook.result.current.background
    expect(left!.columns[0]!.messages[1]).toMatchObject({ text: 'hello', status: 'done' })
    expect(hook.result.current.state.columns[0]!.messages).toEqual([])
  })

  it('reopening it while it runs shows it live, and tokens keep arriving', () => {
    const hook = streaming()
    const firstId = hook.result.current.state.id
    act(() => hook.result.current.newChat())
    act(() => hook.result.current.resume(firstId))

    expect(hook.result.current.state.id).toBe(firstId)
    expect(hook.result.current.background).toEqual([])
    act(() => finish(runs[0]!, 'hello'))
    expect(hook.result.current.state.columns[0]!.messages[1]).toMatchObject({ text: 'hello', status: 'done' })
  })

  it('Esc stops only the open chat, not one finishing in the background', () => {
    const hook = streaming()
    act(() => hook.result.current.newChat())
    act(() => hook.result.current.send('second'))
    act(() => hook.result.current.stop())

    expect(runs[1]!.cancel).toHaveBeenCalledOnce()
    expect(runs[0]!.cancel).not.toHaveBeenCalled()
  })

  it('a deleted chat stops instead of finishing in the background', () => {
    const hook = streaming()
    act(() => hook.result.current.newChat({ discard: true }))
    expect(runs[0]!.cancel).toHaveBeenCalledOnce()
    expect(hook.result.current.background).toEqual([])

    const again = streaming()
    const id = again.result.current.state.id
    act(() => again.result.current.newChat())
    act(() => again.result.current.release(id, { stopRuns: true }))
    expect(runs[1]!.cancel).toHaveBeenCalledOnce()
    expect(again.result.current.background).toEqual([])
  })
})
