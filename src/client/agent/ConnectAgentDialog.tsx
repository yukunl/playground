import { Check, Copy } from 'lucide-react'
import { Tabs } from 'radix-ui'
import { useState, type ReactNode } from 'react'
import { AGENT_TOKEN_HOURS, type AgentTokenHours, type AgentTokenResponse } from '../../shared/agent-token'
import { ApiRequestError, postJson } from '../api'
import { Dialog } from '../ui/dialog'

const SERVER_NAME = 'parasail-playground'
const TOKEN_VAR = 'PLAYGROUND_AGENT_TOKEN'

const HOURS_LABEL: Record<AgentTokenHours, string> = { 24: '1 day', 168: '7 days' }

const EXAMPLE_ASK = `My system prompt is in examples/agent-connect-example/example_prompt.txt, and my test cases with the answers I expect are in examples/agent-connect-example/cases.jsonl. Today I pay $2.00 per million input tokens and $8.00 per million output tokens, with about 900 ms to the first token.
Using ${SERVER_NAME}, test 3 or 4 models at temperature 0 against my expected answers, and compare accuracy, cost and latency with what I have today. Then open your top two in the playground.`

type Props = {
  open: boolean
  onOpenChange: (open: boolean) => void
}

/** How to connect a coding agent to this playground over MCP, with a token made here. */
export function ConnectAgentDialog({ open, onOpenChange }: Props) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange} title="Connect your agent" wide>
      {/* Unmounted on close, so a token is shown once and gone when the dialog is. */}
      {open && <Steps />}
    </Dialog>
  )
}

function Steps() {
  const [hours, setHours] = useState<AgentTokenHours>(AGENT_TOKEN_HOURS[0])
  const [made, setMade] = useState<AgentTokenResponse>()
  const [making, setMaking] = useState(false)
  const [problem, setProblem] = useState<string>()
  const mcpUrl = made?.mcpUrl ?? `${window.location.origin}/api/mcp`

  const make = async () => {
    setMaking(true)
    setProblem(undefined)
    try {
      setMade(await postJson<AgentTokenResponse>('/api/agent-token', { hours }))
    } catch (err) {
      setProblem(err instanceof ApiRequestError ? err.message : 'Couldn’t make a token.')
    } finally {
      setMaking(false)
    }
  }

  return (
    <div className="space-y-4 text-sm">
      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 rounded-md bg-slate-100 px-3 py-2 text-xs text-slate-700 dark:bg-slate-800/70 dark:text-slate-300">
        <dt className="font-semibold">Your agent</dt>
        <dd>Tests a bounded set of models and settings against your baseline, checking accuracy, cost and latency. It judges accuracy; the playground measures speed and cost on every run.</dd>
        <dt className="font-semibold">The playground</dt>
        <dd>Opens the finalists side by side, so you can inspect them and try them yourself.</dd>
      </dl>

      <ol className="space-y-4">
        <Step n={1} title="Make a token">
          {!made ? (
            <div className="flex flex-wrap items-center gap-2">
              <label className="flex items-center gap-1.5 text-xs text-slate-600 dark:text-slate-400">
                Works for
                <select
                  value={hours}
                  onChange={(e) => setHours(Number(e.target.value) as AgentTokenHours)}
                  className="rounded border border-slate-300 bg-white px-1.5 py-1 text-xs text-slate-900 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                >
                  {AGENT_TOKEN_HOURS.map((h) => (
                    <option key={h} value={h}>
                      {HOURS_LABEL[h]}
                    </option>
                  ))}
                </select>
              </label>
              <button
                type="button"
                onClick={() => void make()}
                disabled={making}
                className="rounded-md bg-slate-950 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-500 disabled:cursor-wait disabled:opacity-60 dark:bg-slate-200 dark:text-slate-950 dark:hover:bg-white"
              >
                {making ? 'Making…' : 'Make token'}
              </button>
              {problem && (
                <p role="alert" className="w-full text-xs text-amber-700 dark:text-amber-400">
                  {problem}
                </p>
              )}
            </div>
          ) : (
            <>
              <CopyBlock text={made.token} label="token" />
              <Hint>
                Shown once: copy it now. It opens only the agent connection, not this page, and stops working on {formatExpiry(made.expiresAt)} or after{' '}
                {made.runs} runs.
              </Hint>
            </>
          )}
        </Step>

        <Step n={2} title="Put it in the terminal you’ll start your agent from">
          <CopyBlock text={`read -rs ${TOKEN_VAR} && export ${TOKEN_VAR}`} label="command" />
          <Hint>Run this, paste the token and press Return. Nothing is shown, and the token stays out of your shell history and your files.</Hint>
        </Step>

        <Step n={3} title="Add the playground to your agent">
          <AgentTabs mcpUrl={mcpUrl} />
        </Step>

        <Step n={4} title="Start your agent in that terminal and ask">
          <CopyBlock text={EXAMPLE_ASK} label="example" wrap />
          <Hint>Use your own files and prices. The agent runs each case through the playground and judges the answers.</Hint>
        </Step>

        <Step n={5} title="Open the link it gives you, and press ⌘↵">
          <Hint>The finalists open side by side with the agent’s claims above them. Nothing has run yet: ⌘↵ runs both live, with their speed and cost.</Hint>
        </Step>
      </ol>

      <p className="border-t border-slate-200 pt-3 text-xs text-slate-500 dark:border-slate-800">
        Token lost or shared by mistake? It stops on its own when it expires. Whoever runs this playground can cut off every token at once by changing its password.
      </p>
    </div>
  )
}

function AgentTabs({ mcpUrl }: { mcpUrl: string }) {
  return (
    <Tabs.Root defaultValue="claude">
      <Tabs.List aria-label="Agent" className="mb-2 flex w-fit rounded-md border border-slate-300 p-0.5 dark:border-slate-700">
        {[
          { value: 'claude', label: 'Claude Code' },
          { value: 'codex', label: 'Codex' },
        ].map(({ value, label }) => (
          <Tabs.Trigger
            key={value}
            value={value}
            className="rounded px-2 py-0.5 text-xs text-slate-600 hover:bg-slate-100 hover:text-slate-900 focus-visible:outline-2 focus-visible:outline-brand-500 data-[state=active]:bg-brand-100 data-[state=active]:font-medium data-[state=active]:text-brand-900 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-100 dark:data-[state=active]:bg-brand-950 dark:data-[state=active]:text-brand-100"
          >
            {label}
          </Tabs.Trigger>
        ))}
      </Tabs.List>
      <Tabs.Content value="claude" className="space-y-1.5">
        {/* Single quotes: the variable's name goes into .mcp.json, and Claude Code fills it in when it starts. */}
        <CopyBlock text={`claude mcp add --transport http --scope project \\\n  ${SERVER_NAME} ${mcpUrl} \\\n  --header 'Authorization: Bearer \${${TOKEN_VAR}}'`} label="command" />
        <Hint>Run it in your project folder. It writes .mcp.json with the variable’s name, not the token, so the file is safe to commit. Claude Code asks you to approve the server the first time; /mcp then shows it connected.</Hint>
      </Tabs.Content>
      <Tabs.Content value="codex" className="space-y-1.5">
        <CopyBlock text={`codex mcp add ${SERVER_NAME} \\\n  --url ${mcpUrl} \\\n  --bearer-token-env-var ${TOKEN_VAR}`} label="command" />
        <Hint>Codex saves the variable’s name in ~/.codex/config.toml, not the token. Check with codex mcp list.</Hint>
      </Tabs.Content>
    </Tabs.Root>
  )
}

function Step({ n, title, children }: { n: number; title: string; children: ReactNode }) {
  return (
    <li className="grid grid-cols-[1.5rem_1fr] gap-x-2">
      <span aria-hidden className="mt-px flex size-5 items-center justify-center rounded-full bg-brand-100 text-xs font-semibold text-brand-900 dark:bg-brand-950 dark:text-brand-100">
        {n}
      </span>
      <div className="min-w-0 space-y-1.5">
        <h3 className="font-medium">
          <span className="sr-only">Step {n}: </span>
          {title}
        </h3>
        {children}
      </div>
    </li>
  )
}

function Hint({ children }: { children: ReactNode }) {
  return <p className="text-xs text-slate-500">{children}</p>
}

/** Text to copy, with its own button. `wrap` for prose; commands keep their lines and scroll. */
function CopyBlock({ text, label, wrap = false }: { text: string; label: string; wrap?: boolean }) {
  const [copied, setCopied] = useState<'yes' | 'failed'>()
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text)
      setCopied('yes')
    } catch {
      setCopied('failed')
    }
  }
  return (
    <div className="flex items-start gap-1 rounded-md border border-slate-200 bg-slate-50 dark:border-slate-800 dark:bg-slate-900">
      <pre className={`min-w-0 flex-1 p-2 font-mono text-xs leading-relaxed text-slate-800 select-all dark:text-slate-200 ${wrap ? 'whitespace-pre-wrap' : 'overflow-x-auto'}`}>{text}</pre>
      <button
        type="button"
        onClick={() => void copy()}
        aria-label={`Copy ${label}`}
        title={copied === 'failed' ? 'Couldn’t copy automatically: select the text and press ⌘C' : `Copy ${label}`}
        className="m-1 shrink-0 rounded p-1 text-slate-500 hover:bg-slate-200 hover:text-slate-900 focus-visible:outline-2 focus-visible:outline-brand-500 dark:hover:bg-slate-800 dark:hover:text-slate-100"
      >
        {copied === 'yes' ? <Check aria-hidden className="size-3.5" /> : <Copy aria-hidden className="size-3.5" />}
      </button>
      <span role="status" className="sr-only">
        {copied === 'yes' ? 'Copied' : copied === 'failed' ? 'Couldn’t copy automatically' : ''}
      </span>
    </div>
  )
}

function formatExpiry(iso: string): string {
  return new Date(iso).toLocaleString('en-US', { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
}
