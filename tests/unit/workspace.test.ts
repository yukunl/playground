import { describe, expect, it } from 'vitest'
import { initialWorkspace, workspaceReducer, type Workspace } from '../../src/client/chat/reducer'

/** A workspace whose open chat has an answer streaming under run `r1`. */
function streamingWorkspace(): Workspace {
  let ws = initialWorkspace()
  ws = workspaceReducer(ws, { type: 'updateSettings', columnId: 'col_a', patch: { model: 'm' } })
  return workspaceReducer(ws, { type: 'send', columnId: 'col_a', text: 'hi', runId: 'r1', requestId: 'q1', at: 1 })
}

describe('workspaceReducer', () => {
  it('a new chat moves a streaming chat to the background, and its run events follow it there', () => {
    const before = streamingWorkspace()
    let ws = workspaceReducer(before, { type: 'newChat', id: 'chat_2', at: 2 })
    expect(ws.chat.id).toBe('chat_2')
    expect(ws.background.map((c) => c.id)).toEqual([before.chat.id])

    ws = workspaceReducer(ws, { type: 'tokens', runId: 'r1', text: 'hel', at: 3 })
    ws = workspaceReducer(ws, { type: 'tokens', runId: 'r1', text: 'lo', at: 4 })
    ws = workspaceReducer(ws, { type: 'done', runId: 'r1', finishReason: 'stop', costUsd: 0.001, at: 5 })
    expect(ws.background[0]!.columns[0]!.messages[1]).toMatchObject({ text: 'hello', status: 'done', costUsd: 0.001 })
    expect(ws.chat.columns[0]!.messages).toEqual([])
  })

  it('a chat with nothing streaming is simply left', () => {
    let ws = streamingWorkspace()
    ws = workspaceReducer(ws, { type: 'done', runId: 'r1', finishReason: 'stop', costUsd: null, at: 2 })
    ws = workspaceReducer(ws, { type: 'newChat', id: 'chat_2', at: 3 })
    expect(ws.background).toEqual([])
  })

  it('loading the saved copy of a chat still finishing opens the live one instead', () => {
    const before = streamingWorkspace()
    let ws = workspaceReducer(before, { type: 'newChat', id: 'chat_2', at: 2 })
    ws = workspaceReducer(ws, { type: 'tokens', runId: 'r1', text: 'live', at: 3 })
    // The saved copy was written at Send, before any tokens.
    ws = workspaceReducer(ws, { type: 'load', chat: before.chat })
    expect(ws.chat.columns[0]!.messages[1]).toMatchObject({ text: 'live', status: 'streaming' })
    expect(ws.background).toEqual([])
  })

  it("reloading the open chat while it streams keeps the live answer", () => {
    const ws = streamingWorkspace()
    expect(workspaceReducer(ws, { type: 'load', chat: { ...ws.chat, columns: [] } })).toBe(ws)
  })

  it('release forgets a background chat', () => {
    let ws = workspaceReducer(streamingWorkspace(), { type: 'newChat', id: 'chat_2', at: 2 })
    ws = workspaceReducer(ws, { type: 'release', id: ws.background[0]!.id })
    expect(ws.background).toEqual([])
  })
})
