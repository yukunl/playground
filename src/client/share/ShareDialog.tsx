import { Check, Copy } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import type { ChatState } from '../chat/types'
import { Dialog } from '../ui/dialog'
import { encodeShare, keepsProposal, LONG_LINK_CHARS, MAX_CHAT_LINK_CHARS, sharePayload, shareUrl, type ShareMode } from './share-link'

type Props = {
  open: boolean
  onOpenChange: (open: boolean) => void
  chat: ChatState
  draft: string
}

type Links = Record<ShareMode, string>

/** Share by link (design §11): everything is inside the link, and the dialog says so. */
export function ShareDialog({ open, onOpenChange, chat, draft }: Props) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange} title="Share">
      {open && <ShareForm chat={chat} draft={draft} />}
    </Dialog>
  )
}

function ShareForm({ chat, draft }: { chat: ChatState; draft: string }) {
  const [links, setLinks] = useState<Links>()
  const [mode, setMode] = useState<ShareMode>('setup')
  const [copied, setCopied] = useState<'yes' | 'failed'>()
  const linkInput = useRef<HTMLInputElement>(null)

  // Both links are made up front, so the dialog can say whether "whole chat" fits.
  useEffect(() => {
    let cancelled = false
    Promise.all([encodeShare(sharePayload(chat, 'setup', draft)), encodeShare(sharePayload(chat, 'chat', draft))]).then(([setup, whole]) => {
      if (!cancelled) setLinks({ setup: shareUrl(setup), chat: shareUrl(whole) })
    })
    return () => {
      cancelled = true
    }
  }, [chat, draft])

  const hasMessages = chat.columns.some((col) => col.messages.some((m) => m.text))
  const chatTooLong = links !== undefined && links.chat.length > MAX_CHAT_LINK_CHARS
  const chatDisabledReason = !hasMessages ? 'No messages yet.' : chatTooLong ? 'Too long for a link. Share just the setup instead.' : undefined
  const link = links?.[mode]

  const choose = (next: ShareMode) => {
    setMode(next)
    setCopied(undefined)
  }

  const copy = async () => {
    if (!link) return
    try {
      await navigator.clipboard.writeText(link)
      setCopied('yes')
    } catch {
      // Clipboard access can be refused; the link is shown selected so it can be copied by hand.
      setCopied('failed')
      requestAnimationFrame(() => linkInput.current?.select())
    }
  }

  return (
    <div className="space-y-4 text-sm">
      <fieldset className="space-y-2">
        <legend className="sr-only">What to share</legend>
        <Choice
          checked={mode === 'setup'}
          onChange={() => choose('setup')}
          label="Just the setup"
          hint={`${chat.columns.length > 1 ? 'Both columns’ models, settings and system prompts' : 'Model, settings, system prompt'}${draft.trim() ? ', and the message you’re typing' : ''}.`}
        />
        <Choice
          checked={mode === 'chat'}
          onChange={() => choose('chat')}
          label="Whole chat"
          hint={chatDisabledReason ?? 'Adds every message and answer.'}
          disabled={Boolean(chatDisabledReason)}
        />
      </fieldset>

      {chat.proposal && <p className="text-xs text-slate-500">{proposalLine(chat, mode)}</p>}

      <p className="rounded-md bg-slate-100 px-3 py-2 text-xs text-slate-700 dark:bg-slate-800/70 dark:text-slate-300">
        Everything is inside the link: anyone who has it can see these prompts, and links can’t be taken back.
      </p>

      {link && link.length > LONG_LINK_CHARS && (
        <p className="text-xs text-amber-700 dark:text-amber-400">
          This link is {link.length.toLocaleString('en-US')} characters. Long links can get cut off in some apps.{' '}
          {mode === 'chat' && (
            <button type="button" onClick={() => choose('setup')} className="underline underline-offset-2">
              Share just the setup instead?
            </button>
          )}
        </p>
      )}

      {copied && link && (
        <div className="space-y-1">
          <p className={`text-xs ${copied === 'yes' ? 'text-emerald-700 dark:text-emerald-400' : 'text-amber-700 dark:text-amber-400'}`} role="status">
            {copied === 'yes' ? '✓ Link copied' : 'Couldn’t copy automatically. The link is selected below: copy it with ⌘C.'}
          </p>
          <input
            ref={linkInput}
            readOnly
            value={link}
            aria-label="Share link"
            onFocus={(e) => e.currentTarget.select()}
            className="w-full truncate rounded border border-slate-200 bg-slate-50 px-2 py-1 font-mono text-[11px] text-slate-600 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-400"
          />
        </div>
      )}

      <div className="flex justify-end">
        <button
          type="button"
          onClick={() => void copy()}
          disabled={!link}
          className="flex items-center gap-1.5 rounded-md bg-slate-950 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-500 disabled:opacity-50 dark:bg-slate-200 dark:text-slate-950 dark:hover:bg-white"
        >
          {copied === 'yes' ? <Check aria-hidden className="size-4" /> : <Copy aria-hidden className="size-4" />}
          {copied === 'yes' ? 'Copied' : 'Copy link'}
        </button>
      </div>
    </div>
  )
}

/** What happens to an agent's proposal in this link. */
function proposalLine(chat: ChatState, mode: ShareMode): string {
  const by = chat.proposal!.by
  if (mode === 'chat') return `Leaves out ${by}’s proposal: a proposal never carries answers, so the next person runs it themselves.`
  return keepsProposal(chat)
    ? `Includes ${by}’s proposal: its note and the choice names.`
    : `Leaves out ${by}’s proposal, because its settings were changed here. Otherwise your edits would look like ${by}’s.`
}

function Choice({ checked, onChange, label, hint, disabled = false }: { checked: boolean; onChange: () => void; label: string; hint: string; disabled?: boolean }) {
  return (
    <label className={`flex gap-2.5 rounded-md border px-3 py-2 ${checked ? 'border-brand-500 bg-brand-50/50 dark:bg-brand-950/20' : 'border-slate-200 dark:border-slate-800'} ${disabled ? 'cursor-not-allowed opacity-60' : 'cursor-pointer'}`}>
      <input type="radio" name="share-mode" checked={checked} onChange={onChange} disabled={disabled} className="mt-0.5 accent-brand-600" />
      <span>
        <span className="block font-medium">{label}</span>
        <span className="block text-xs text-slate-500">{hint}</span>
      </span>
    </label>
  )
}
