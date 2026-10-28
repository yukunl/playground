import { Link2, X } from 'lucide-react'

/** The banner above the chat after opening a share link. */
export type Notice = { kind: 'shared'; model: string; switchedTo?: string } | { kind: 'damaged' }

type Props = {
  notice: Notice
  nameOf: (id: string) => string
  onDismiss: () => void
  onNewChat: () => void
}

export function NoticeBar({ notice, nameOf, onDismiss, onNewChat }: Props) {
  if (notice.kind === 'damaged') {
    return (
      <div role="alert" className="mb-6 flex flex-wrap items-center justify-between gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-200">
        <p>This link is damaged or incomplete. It may have been cut off when it was copied.</p>
        <button type="button" onClick={onNewChat} className="shrink-0 font-medium underline underline-offset-2 hover:no-underline">
          Start a new chat
        </button>
      </div>
    )
  }
  return (
    <div role="status" className="mb-6 flex items-start justify-between gap-2 rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700 dark:border-slate-800 dark:bg-slate-900/60 dark:text-slate-300">
      <p className="flex items-start gap-1.5">
        <Link2 aria-hidden className="mt-0.5 size-4 shrink-0" />
        <span>
          Opened from a shared link.
          {notice.switchedTo && ` Shared with ${nameOf(notice.model)}, which isn’t available here. Switched to ${nameOf(notice.switchedTo)}.`}
        </span>
      </p>
      <button type="button" onClick={onDismiss} aria-label="Dismiss" className="shrink-0 rounded p-0.5 hover:bg-slate-200/70 dark:hover:bg-slate-800">
        <X aria-hidden className="size-4" />
      </button>
    </div>
  )
}
