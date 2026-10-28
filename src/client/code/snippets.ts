// "Code" (docs/design.md §11.2): a column's setup as a curl or Python call a
// developer can paste into their own app. Both are generated from buildChatRequest's
// output, the same body the server sends upstream, so the model, prompt and
// settings can't drift from what the playground runs.
import { buildChatRequest } from '../../shared/build-chat-request'
import type { ChatMessage } from '../../shared/chat'
import type { Column } from '../chat/types'

/**
 * Parasail's documented OpenAI-compatible base URL. Not the server's
 * PARASAIL_BASE_URL: the code runs in the developer's app, against the real API.
 */
export const PARASAIL_API_BASE = 'https://api.parasail.io/v1'

/** Sent when there's no message to use, so the code still runs. */
export const PLACEHOLDER_MESSAGE = 'Your message here'

export type CodeLanguage = 'curl' | 'python'
export type ChatBody = Omit<ReturnType<typeof buildChatRequest>, 'stream' | 'stream_options'>

/** One user message: the one being typed, else the last one sent, else a placeholder. */
export function codeMessages(col: Column, draft: string): ChatMessage[] {
  const last = col.messages.findLast((m) => m.role === 'user')
  return [{ role: 'user', content: draft.trim() ? draft : (last?.text ?? PLACEHOLDER_MESSAGE) }]
}

/**
 * The server's body without streaming, which is how the playground shows an
 * answer, not part of the setup. The code gets the whole answer in one response.
 */
export function codeBody(col: Column, draft: string): ChatBody {
  const { stream: _, stream_options: __, ...body } = buildChatRequest({ settings: col.settings, messages: codeMessages(col, draft) })
  return body
}

/**
 * The body goes in a quoted heredoc, so the shell expands nothing in it: quotes,
 * `$` and backslashes in a prompt need no escaping. JSON never puts a raw newline
 * inside a string, so no line of the body can be the closing `EOF`.
 */
export function curlSnippet(body: ChatBody): string {
  return [
    `curl ${PARASAIL_API_BASE}/chat/completions \\`,
    '  -H "Authorization: Bearer $PARASAIL_API_KEY" \\',
    '  -H "Content-Type: application/json" \\',
    "  --data-binary @- <<'EOF'",
    JSON.stringify(body, null, 2),
    'EOF',
  ].join('\n')
}

/** The OpenAI SDK pointed at Parasail, with every field of the body as an argument. */
export function pythonSnippet(body: ChatBody): string {
  const args = Object.entries(body).map(([key, value]) => `    ${key}=${pythonLiteral(value, 1)},`)
  return [
    '# pip install openai',
    'import os',
    '',
    'from openai import OpenAI',
    '',
    'client = OpenAI(',
    `    base_url=${JSON.stringify(PARASAIL_API_BASE)},`,
    '    api_key=os.environ["PARASAIL_API_KEY"],',
    ')',
    '',
    'response = client.chat.completions.create(',
    ...args,
    ')',
    '',
    'print(response.choices[0].message.content)',
  ].join('\n')
}

export function snippet(language: CodeLanguage, body: ChatBody): string {
  return language === 'curl' ? curlSnippet(body) : pythonSnippet(body)
}

/**
 * A JSON value as Python source. A JSON string is also a valid Python string
 * literal, so strings go through JSON.stringify. Lists of objects (the messages)
 * get one item per line; everything else stays on one line.
 */
function pythonLiteral(value: unknown, depth: number): string {
  if (value === null || value === undefined) return 'None'
  if (value === true) return 'True'
  if (value === false) return 'False'
  if (typeof value === 'string' || typeof value === 'number') return JSON.stringify(value)
  if (Array.isArray(value)) {
    if (!value.some((item) => typeof item === 'object' && item !== null)) return `[${value.map((item) => pythonLiteral(item, depth)).join(', ')}]`
    const indent = '    '.repeat(depth + 1)
    return `[\n${value.map((item) => `${indent}${pythonLiteral(item, depth + 1)},`).join('\n')}\n${'    '.repeat(depth)}]`
  }
  return `{${Object.entries(value as Record<string, unknown>)
    .map(([key, item]) => `${JSON.stringify(key)}: ${pythonLiteral(item, depth)}`)
    .join(', ')}}`
}
