import { memo, useState } from 'react'
import ReactMarkdown, { type Components } from 'react-markdown'
import remarkGfm from 'remark-gfm'

// Model output is untrusted: react-markdown never renders raw HTML as elements,
// and its default URL check strips links like `javascript:`.
const components: Components = {
  pre: ({ node }) => {
    const code = node?.children[0]
    const className = code?.type === 'element' ? code.properties.className : undefined
    const language = Array.isArray(className)
      ? String(className.find((c) => String(c).startsWith('language-')) ?? '').replace('language-', '')
      : ''
    return <CodeBlock language={language} code={textOf(code)} />
  },
  a: ({ children, href }) => (
    <a href={href} target="_blank" rel="noreferrer noopener">
      {children}
    </a>
  ),
}

/** Re-renders only when its text changes, so finished messages stay still while another streams. */
export const Markdown = memo(function Markdown({ text }: { text: string }) {
  return (
    // Inline code: a tinted chip instead of the typography plugin's literal backticks, and full size
    // inside table cells, where prose-sm's 0.857em of 12px came out at 10px.
    <div className="prose prose-sm prose-neutral max-w-none dark:prose-invert prose-pre:my-0 prose-pre:bg-transparent prose-pre:p-0 prose-code:rounded prose-code:bg-slate-100 prose-code:px-1 prose-code:py-0.5 prose-code:font-medium prose-code:before:content-none prose-code:after:content-none dark:prose-code:bg-slate-800 [&_td_code]:text-[1em] [&_th_code]:text-[1em]">
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
        {text}
      </ReactMarkdown>
    </div>
  )
})

function CodeBlock({ language, code }: { language: string; code: string }) {
  const [copied, setCopied] = useState(false)
  const copy = async () => {
    await navigator.clipboard.writeText(code)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }
  return (
    <div className="not-prose my-3 overflow-hidden rounded-md border border-slate-200 dark:border-slate-800">
      <div className="flex items-center justify-between border-b border-slate-200 bg-slate-50 px-3 py-1 text-xs text-slate-500 dark:border-slate-800 dark:bg-slate-900">
        <span className="font-mono">{language || 'text'}</span>
        <button
          type="button"
          onClick={copy}
          className="rounded px-1.5 py-0.5 hover:bg-slate-200 hover:text-slate-900 focus-visible:outline-2 focus-visible:outline-brand-500 dark:hover:bg-slate-800 dark:hover:text-slate-100"
        >
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
      <pre className="overflow-x-auto bg-white p-3 font-mono text-[13px] leading-relaxed dark:bg-slate-950">
        <code>{code}</code>
      </pre>
    </div>
  )
}

type HastNode = { type: string; value?: string; children?: HastNode[] } | undefined

function textOf(node: HastNode): string {
  if (!node) return ''
  if (node.type === 'text') return node.value ?? ''
  return (node.children ?? []).map(textOf).join('')
}
