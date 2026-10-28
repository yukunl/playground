import { Dialog as RadixDialog } from 'radix-ui'
import { useRef, type ReactNode } from 'react'

type Props = {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  children: ReactNode
  /** 'center' for a dialog; 'right' and 'left' for drawers (settings on narrow screens, history). */
  placement?: 'center' | 'right' | 'left'
  /** Runs once the dialog has opened and placed focus. */
  onOpened?: () => void
  /** A centered dialog with room for code: wider, and scrolls when taller than the screen. */
  wide?: boolean
}

const CENTER =
  'fixed left-1/2 top-1/2 z-50 outline-none -translate-x-1/2 -translate-y-1/2 rounded-lg border border-slate-200 bg-white p-5 shadow-xl dark:border-slate-800 dark:bg-slate-950'
const WIDE_CENTER = `${CENTER} w-[min(44rem,calc(100vw-2rem))] max-h-[calc(100dvh-2rem)] overflow-y-auto`
const DRAWER = 'fixed inset-y-0 z-50 overflow-y-auto outline-none border-slate-200 bg-white shadow-xl dark:border-slate-800 dark:bg-slate-950'
const PLACEMENT_CLASSES = {
  center: `${CENTER} w-[min(28rem,calc(100vw-2rem))]`,
  right: `${DRAWER} right-0 w-[min(22rem,100vw)] border-l`,
  left: `${DRAWER} left-0 w-[min(20rem,100vw)] border-r`,
}

/**
 * Radix keeps focus inside while open and closes on Esc. Our dialogs are opened
 * from code (shortcuts, header buttons) rather than a Radix Trigger, so Radix has
 * nothing to return focus to; this wrapper remembers what had focus and restores it.
 */
export function Dialog({ open, onOpenChange, title, children, placement = 'center', onOpened, wide = false }: Props) {
  const returnFocusTo = useRef<HTMLElement | null>(null)
  const content = useRef<HTMLDivElement>(null)
  return (
    <RadixDialog.Root open={open} onOpenChange={onOpenChange}>
      <RadixDialog.Portal>
        <RadixDialog.Overlay className="fixed inset-0 z-40 bg-black/30 dark:bg-black/50" />
        <RadixDialog.Content
          ref={content}
          aria-describedby={undefined}
          tabIndex={-1}
          onOpenAutoFocus={(e) => {
            // Focus hasn't moved yet, so this is whatever opened the dialog.
            returnFocusTo.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
            // Focus the dialog itself, not its first button: in the settings drawer that's
            // an ⓘ whose tooltip would pop open and swallow the first Esc.
            e.preventDefault()
            content.current?.focus()
            if (onOpened) requestAnimationFrame(onOpened)
          }}
          onCloseAutoFocus={(e) => {
            const target = returnFocusTo.current
            if (target && document.contains(target)) {
              e.preventDefault()
              target.focus()
            }
          }}
          className={placement === 'center' && wide ? WIDE_CENTER : PLACEMENT_CLASSES[placement]}
        >
          <RadixDialog.Title className={placement === 'center' ? 'mb-3 text-sm font-semibold' : 'sr-only'}>{title}</RadixDialog.Title>
          {/* Drawers bring their own ✕ in their header: on a phone there's no Esc, and the overlay strip beside them is thin. */}
          {children}
        </RadixDialog.Content>
      </RadixDialog.Portal>
    </RadixDialog.Root>
  )
}
