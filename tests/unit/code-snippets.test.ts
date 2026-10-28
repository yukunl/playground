import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import type { AssistantMessage, Column, Message } from '../../src/client/chat/types'
import { codeBody, codeMessages, curlSnippet, PARASAIL_API_BASE, PLACEHOLDER_MESSAGE, pythonSnippet } from '../../src/client/code/snippets'
import { buildChatRequest } from '../../src/shared/build-chat-request'
import { DEFAULT_SETTINGS, type Settings } from '../../src/shared/chat'

const settings: Settings = { ...DEFAULT_SETTINGS, model: 'parasail-llama-33-70b-fp8', system: 'Be brief.', temperature: 0.3, topP: 0.9, maxTokens: 256, stop: ['###'], seed: 7 }
const answer = (text: string, over: Partial<AssistantMessage> = {}): AssistantMessage => ({
  role: 'assistant',
  runId: 'r',
  requestId: 'q',
  text,
  status: 'done',
  settingsUsed: settings,
  startedAt: 0,
  attempts: [],
  ...over,
})
const column = (messages: Message[], over: Partial<Settings> = {}): Column => ({ id: 'col_a', settings: { ...settings, ...over }, messages })

/** Everything a shell or Python could get wrong in a string. */
const AWKWARD = [
  `It's "quoted" with $HOME, \`whoami\`, $(date) and a \\ backslash.`,
  'EOF',
  "'EOF'",
  'Tabs\tand \\n literal, emoji 🚀, accents é, a line separator   and a null \u0000.',
].join('\n')

describe('codeBody', () => {
  const chat = column([{ role: 'user', text: 'first' }, answer('reply'), { role: 'user', text: 'second' }, answer('', { status: 'failed' })])

  it('sends one message: the one being typed, else the last one sent, else a placeholder', () => {
    expect(codeMessages(chat, 'typed')).toEqual([{ role: 'user', content: 'typed' }])
    expect(codeMessages(chat, '  ')).toEqual([{ role: 'user', content: 'second' }])
    expect(codeMessages(column([]), '')).toEqual([{ role: 'user', content: PLACEHOLDER_MESSAGE }])
  })

  it('is the body the server would send, without streaming', () => {
    const { stream: _, stream_options: __, ...sent } = buildChatRequest({ settings, messages: [{ role: 'user', content: 'typed' }] })
    expect(codeBody(chat, 'typed')).toEqual(sent)
  })
})

describe('curlSnippet', () => {
  const body = codeBody(column([], { system: AWKWARD }), AWKWARD)

  it('calls the chat endpoint with the key from the environment, never a real one', () => {
    const curl = curlSnippet(body)
    expect(curl).toMatch(new RegExp(`^curl ${PARASAIL_API_BASE}/chat/completions \\\\$`, 'm'))
    expect(curl).toContain('"Authorization: Bearer $PARASAIL_API_KEY"')
    expect(curl).not.toContain('psk-')
  })

  it('reaches curl as exactly the body, whatever the prompt holds', () => {
    // A stand-in curl that prints what it was given on stdin, run by a real shell.
    const sent = execFileSync('bash', ['-c', `curl() { cat; }\n${curlSnippet(body)}`], { encoding: 'utf8' })
    expect(JSON.parse(sent)).toEqual(body)
  })

  it('leaves out stop and seed when they are empty, like the server', () => {
    const plain = codeBody(column([], { stop: [], seed: undefined }), 'hi')
    expect(curlSnippet(plain)).not.toMatch(/"stop"|"seed"/)
  })
})

describe('pythonSnippet', () => {
  const body = codeBody(column([{ role: 'user', text: AWKWARD }, answer(AWKWARD)], { system: AWKWARD }), AWKWARD)
  const python = hasPython()
  const stubDir = mkdtempSync(join(tmpdir(), 'openai-stub-'))
  afterAll(() => rmSync(stubDir, { recursive: true, force: true }))

  it('uses the OpenAI SDK pointed at Parasail, with the key from the environment', () => {
    const code = pythonSnippet(body)
    expect(code).toContain(`base_url="${PARASAIL_API_BASE}"`)
    expect(code).toContain('api_key=os.environ["PARASAIL_API_KEY"]')
    expect(code).not.toContain('psk-')
  })

  it.skipIf(!python)('passes exactly the body as arguments, whatever the prompt holds', () => {
    // A stand-in openai module that prints the arguments create() received.
    writeFileSync(
      join(stubDir, 'openai.py'),
      [
        'import json',
        'from types import SimpleNamespace',
        'class _Completions:',
        '    def create(self, **kwargs):',
        '        print(json.dumps(kwargs))',
        '        return SimpleNamespace(choices=[SimpleNamespace(message=SimpleNamespace(content=""))])',
        'class _Chat:',
        '    completions = _Completions()',
        'class OpenAI:',
        '    def __init__(self, base_url, api_key):',
        '        self.chat = _Chat()',
      ].join('\n'),
    )
    const sent = execFileSync('python3', ['-c', pythonSnippet(body)], {
      encoding: 'utf8',
      env: { ...process.env, PYTHONPATH: stubDir, PARASAIL_API_KEY: 'test' },
    })
    expect(JSON.parse(sent)).toEqual(body)
  })

  it('leaves out stop and seed when they are empty, like the server', () => {
    const plain = codeBody(column([], { stop: [], seed: undefined }), 'hi')
    expect(pythonSnippet(plain)).not.toMatch(/stop=|seed=/)
  })
})

function hasPython(): boolean {
  try {
    execFileSync('python3', ['--version'])
    return true
  } catch {
    return false
  }
}
