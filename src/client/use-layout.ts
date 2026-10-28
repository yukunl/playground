import { useRef, useState } from 'react'
import { readStorage, writeStorage } from './storage'
import { useMediaQuery } from './use-media-query'

/** Whether the history sidebar is shown on wide screens, remembered in this browser. */
const SIDEBAR_KEY = 'playground.sidebar'
/** Whether the settings sidebar is shown on wide screens, remembered in this browser. */
const SETTINGS_KEY = 'playground.settings'

/**
 * The page's frame: history on the left and settings on the right are sidebars on wide
 * screens (shown or hidden, remembered) and drawers on narrow ones. Compare shows its
 * panels next to each other from tablet width up, and as tabs below it.
 */
export function useLayout() {
  const wide = useMediaQuery('(min-width: 1024px)')
  const sideBySide = useMediaQuery('(min-width: 768px)')
  const [historyOpen, setHistoryOpen] = useState(() => readStorage(SIDEBAR_KEY) !== 'closed')
  const [historyDrawerOpen, setHistoryDrawerOpen] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(() => readStorage(SETTINGS_KEY) !== 'closed')
  const [settingsDrawerOpen, setSettingsDrawerOpen] = useState(false)
  // The history handle that was clicked goes away, so focus moves to the one that replaces it.
  const handleTakesFocus = useRef(false)

  const showSettingsSidebar = (open: boolean) => {
    writeStorage(SETTINGS_KEY, open ? 'open' : 'closed')
    setSettingsOpen(open)
  }

  return {
    wide,
    sideBySide,
    history: {
      sidebar: wide && historyOpen,
      drawerOpen: historyDrawerOpen,
      setDrawerOpen: setHistoryDrawerOpen,
      handleTakesFocus,
      toggle: () => {
        if (!wide) return setHistoryDrawerOpen(true)
        handleTakesFocus.current = true
        writeStorage(SIDEBAR_KEY, historyOpen ? 'closed' : 'open')
        setHistoryOpen(!historyOpen)
      },
    },
    settings: {
      sidebar: wide && settingsOpen,
      drawerOpen: settingsDrawerOpen,
      setDrawerOpen: setSettingsDrawerOpen,
      shown: wide ? settingsOpen : settingsDrawerOpen,
      toggle: () => (wide ? showSettingsSidebar(!settingsOpen) : setSettingsDrawerOpen(true)),
      closeSidebar: () => showSettingsSidebar(false),
    },
  }
}
