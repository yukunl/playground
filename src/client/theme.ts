import { useEffect, useState } from 'react'
import { useMediaQuery } from './use-media-query'

export type Theme = 'system' | 'light' | 'dark'

// index.html reads the same key before first paint, so a dark page doesn't flash white.
export const THEME_KEY = 'playground.theme'
const DARK_QUERY = '(prefers-color-scheme: dark)'
const ORDER: Theme[] = ['system', 'light', 'dark']

/** The theme after this one, for a button that cycles System → Light → Dark. */
export function nextTheme(theme: Theme): Theme {
  return ORDER[(ORDER.indexOf(theme) + 1) % ORDER.length]!
}

export function readTheme(): Theme {
  try {
    const saved = localStorage.getItem(THEME_KEY)
    return saved === 'light' || saved === 'dark' ? saved : 'system'
  } catch {
    return 'system'
  }
}

/** The chosen theme, kept on <html> as the `dark` class and remembered in this browser. */
export function useTheme(): [Theme, (theme: Theme) => void] {
  const [theme, setTheme] = useState(readTheme)
  const systemDark = useMediaQuery(DARK_QUERY)
  const dark = theme === 'dark' || (theme === 'system' && systemDark)

  useEffect(() => {
    document.documentElement.classList.toggle('dark', dark)
  }, [dark])

  const choose = (next: Theme) => {
    setTheme(next)
    // Storage can throw (private windows, blocked storage). Not remembering is fine.
    try {
      if (next === 'system') localStorage.removeItem(THEME_KEY)
      else localStorage.setItem(THEME_KEY, next)
    } catch {
      // ignore
    }
  }
  return [theme, choose]
}
