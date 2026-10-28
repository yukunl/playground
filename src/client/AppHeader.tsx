import { Bot, CodeXml, Monitor, Moon, Share, Sun, type LucideIcon } from 'lucide-react'
import type { ReactNode } from 'react'
import { nextTheme, useTheme, type Theme } from './theme'
import { ParasailMark } from './ui/parasail-mark'

const THEMES: Record<Theme, { label: string; Icon: LucideIcon }> = {
  system: { label: 'System', Icon: Monitor },
  light: { label: 'Light', Icon: Sun },
  dark: { label: 'Dark', Icon: Moon },
}

type Props = {
  onAgent: () => void
  onCode: () => void
  onShare: () => void
  onShortcuts: () => void
}

/** The name, then app-wide actions only. The mode, the models and the settings are in the prompt box. */
export function AppHeader({ onAgent, onCode, onShare, onShortcuts }: Props) {
  const [theme, setTheme] = useTheme()
  const ThemeIcon = THEMES[theme].Icon
  return (
    <header className="flex items-center justify-between gap-3 border-b border-slate-200 px-3 py-2 sm:px-4 dark:border-slate-800">
      <div className="flex min-w-0 items-center gap-1">
        <h1 className="flex min-w-0 items-center gap-2 text-sm font-semibold tracking-tight">
          <ParasailMark className="size-4 shrink-0" />
          {/* On a phone the sail mark stands alone; the name stays for screen readers. */}
          <span className="truncate max-sm:sr-only">
            Parasail <span className="ml-0.5 font-normal text-slate-500">Playground</span>
          </span>
        </h1>
      </div>
      <div className="flex shrink-0 items-center gap-0.5 whitespace-nowrap text-xs text-slate-500">
        <HeaderButton onClick={onAgent} label="Agent" title="Connect your own coding agent (Claude Code, Codex) to try models through this playground">
          <Bot aria-hidden className="size-3.5" />
        </HeaderButton>
        <HeaderButton onClick={onCode} label="Code" title="Code: the setup as a curl or Python call to Parasail's API">
          <CodeXml aria-hidden className="size-3.5" />
        </HeaderButton>
        <HeaderButton onClick={onShare} label="Share" title="Share the setup or the whole chat as a link">
          <Share aria-hidden className="size-3.5" />
        </HeaderButton>
        <HeaderButton onClick={() => setTheme(nextTheme(theme))} title={`Theme: ${THEMES[theme].label} (click for ${THEMES[nextTheme(theme)].label})`}>
          <ThemeIcon aria-hidden className="size-3.5" />
        </HeaderButton>
        <HeaderButton onClick={onShortcuts} title="Keyboard shortcuts (⌘/)" className="hidden sm:block">
          ⌘/
        </HeaderButton>
      </div>
    </header>
  )
}

type HeaderButtonProps = {
  children: ReactNode
  onClick: () => void
  title: string
  /** The name for screen readers when the button shows only an icon; the title is the tooltip. */
  label?: string
  className?: string
}

function HeaderButton({ children, onClick, title, label, className = '' }: HeaderButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={title}
      className={`rounded px-1.5 py-1 hover:bg-slate-100 hover:text-slate-900 focus-visible:outline-2 focus-visible:outline-brand-500 sm:px-2 dark:hover:bg-slate-800 dark:hover:text-slate-100 ${className}`}
    >
      {children}
    </button>
  )
}
