import { lazy, Suspense, useEffect, useState } from 'react'
import type { Settings } from '../shared/chat'
import { ConnectAgentDialog } from './agent/ConnectAgentDialog'
import { AppHeader } from './AppHeader'
import { ChatPanels, panelLabel } from './chat/ChatPanels'
import { ColumnHeader, ColumnView } from './chat/ColumnView'
import { panelDifferences } from './chat/differences'
import { EmptyState } from './chat/EmptyState'
import type { Mode } from './chat/ModeSwitch'
import { PromptBox } from './chat/PromptBox'
import { freeColumnId } from './chat/reducer'
import type { Column } from './chat/types'
import { isBusy, useChat } from './chat/use-chat'
import { CodeDialog } from './code/CodeDialog'
import { planFromUrl, WEATHER, type WeatherPreset } from './debug/weather'
import type { RunActions } from './errors/ErrorCard'
import { HistoryHandle } from './history/HistoryHandle'
import { HistoryPanel } from './history/HistoryPanel'
import { useHistory } from './history/use-history'
import { newId } from './ids'
import { modelName } from './model-names'
import { anyChanged, differingTunables, estimatePromptTokens } from './settings/settings-logic'
import { SettingsPanel } from './settings/SettingsPanel'
import { SettingsSidebar } from './settings/SettingsSidebar'
import { NoticeBar, type Notice } from './share/NoticeBar'
import { ProposalBanner } from './share/ProposalBanner'
import { changedSinceProposed, chatFromShare } from './share/share-link'
import { ShareDialog } from './share/ShareDialog'
import { OPENED_WITH_SHARE_LINK, useSharedLink } from './share/use-shared-link'
import { ShortcutsDialog, useShortcuts } from './shortcuts'
import { Dialog } from './ui/dialog'
import { chatUsage, formatUsage, panelUsages } from './usage'
import { useHealth } from './use-health'
import { useLayout } from './use-layout'
import { defaultModel, rememberModel, useModels } from './use-models'

const DEBUG = new URLSearchParams(window.location.search).has('debug')
// Weather control is only shown with `?debug`, so its code only loads then.
const WeatherControl = lazy(() => import('./debug/WeatherControl').then((m) => ({ default: m.WeatherControl })))

type OpenDialog = 'agent' | 'share' | 'code' | 'shortcuts'

/**
 * The page: wires chat state (useChat), saved chats (useHistory), the model list and
 * the frame (useLayout) to the header, the panels, the prompt box and the sidebars.
 */
export function App() {
  const { models, pricesAsOf, loading, refreshing, refresh, error: modelsError, refreshError } = useModels()
  const health = useHealth()
  const layout = useLayout()
  const nameOf = (id: string) => modelName(models.find((m) => m.id === id), id)
  // How runs fail on purpose: the Weather control preset, else `?_simulate` on the page URL.
  const [weather, setWeather] = useState<WeatherPreset>('clear')
  const chat = useChat(() => (weather !== 'clear' ? WEATHER[weather].plan : planFromUrl(window.location.search)))
  const { isStreaming } = chat
  const { columns } = chat.state
  // Single is one column; Compare is two, A and B, with one prompt sent to both.
  const comparing = columns.length > 1
  const [colA, colB] = columns as [Column, Column | undefined]
  // In Compare, ⌘K and ⌘⇧↵ act on the focused panel (click a panel to focus it).
  const [focusedId, setFocusedId] = useState('col_a')
  const focused = columns.find((col) => col.id === focusedId) ?? colA
  // What A and B differ in besides the model, for the panel headers.
  const differing = colB ? differingTunables(colA.settings, colB.settings) : []
  const [draft, setDraft] = useState('')
  // False while a setting holds a value that can't be sent. Run waits until it's fixed.
  const [settingsValid, setSettingsValid] = useState(true)
  const [pickerOpen, setPickerOpen] = useState(false)
  const [dialog, setDialog] = useState<OpenDialog | null>(null)
  const dialogProps = (name: OpenDialog) => ({ open: dialog === name, onOpenChange: (open: boolean) => setDialog(open ? name : null) })
  const [notice, setNotice] = useState<Notice>()

  // Pick the default model once the list arrives, and again if the current one
  // isn't in it (a mock model ID after switching to the real API, a retired model,
  // a share link from somewhere with other models). A share link says so.
  const { updateSettings } = chat
  const columnModels = columns.map((col) => col.settings.model).join('\n')
  useEffect(() => {
    if (models.length === 0) return
    const replacement = defaultModel(models)
    columns.forEach((col, i) => {
      if (models.some((m) => m.id === col.settings.model)) return
      if (i === 0 && notice?.kind === 'shared' && col.settings.model && notice.model === col.settings.model) setNotice({ ...notice, switchedTo: replacement })
      updateSettings(col.id, { model: replacement })
    })
    // `columns` changes with every token; only their models matter here.
  }, [models, columnModels, updateSettings, notice])

  /** A panel can run again once it has a message, isn't streaming, and the settings are valid. */
  const canRunAgainIn = (col: Column) => Boolean(col.messages.length > 0 && !isBusy(col) && col.settings.model && settingsValid)
  const blockedReason = columns.some((col) => !col.settings.model) ? 'Pick a model first.' : !settingsValid ? 'Fix the highlighted setting first.' : undefined

  const run = (text = draft) => {
    if (!text.trim() || isStreaming || blockedReason) return
    chat.send(text)
    setDraft('')
  }

  /** ⌘K, or Switch model on an error card: opens that panel's model chip in the prompt box. */
  const openModelPicker = (columnId?: string) => {
    if (columnId) setFocusedId(columnId)
    setPickerOpen(true)
  }

  /** Another chat is now open: start with an empty prompt, no notice and the history drawer closed. */
  const showChat = () => {
    setDraft('')
    setNotice(undefined)
    layout.history.setDrawerOpen(false)
  }

  /** A fresh chat in the same mode (⌘⇧O). An answer still streaming keeps going in the background and is saved when it ends. */
  const newChat = () => {
    chat.newChat()
    showChat()
  }

  /** The mode switch. Compare copies A into B; Single closes B. */
  const changeMode = (mode: Mode) => {
    if (mode === 'compare') {
      setFocusedId(freeColumnId(columns))
      chat.startCompare()
    } else if (colB) {
      chat.closeColumn(colB.id)
      setFocusedId(colA.id)
    }
  }

  /** An edit from one side's controls changes only that side. */
  const editColumn = (col: Column) => (patch: Partial<Settings>) => {
    chat.updateSettings(col.id, patch)
    if (patch.model) rememberModel(patch.model)
  }

  const history = useHistory({
    chat: chat.state,
    background: chat.background,
    onOpen: (saved) => {
      chat.load(saved)
      showChat()
    },
    // Deleted while open: start fresh, and stop its answer rather than finish it in the background.
    onOpenChatDeleted: () => {
      chat.newChat({ discard: true })
      setDraft('')
      setNotice(undefined)
    },
    skipRestore: OPENED_WITH_SHARE_LINK,
  })
  const { refresh: refreshHistory, saveNow } = history
  useEffect(() => refreshHistory(), [refreshHistory])

  // A chat left mid-answer is saved once its answers end, then let go.
  const { background, release } = chat
  useEffect(() => {
    for (const c of background) {
      if (c.columns.some(isBusy)) continue
      saveNow(c)
      release(c.id)
    }
  }, [background, saveNow, release])

  const generating = new Set([...background.map((c) => c.id), ...(isStreaming ? [chat.state.id] : [])])
  const openSaved = (id: string) => {
    if (background.some((c) => c.id === id)) {
      chat.resume(id)
      showChat()
    } else {
      void history.open(id)
    }
  }
  const deleteSaved = (id: string) => {
    if (background.some((c) => c.id === id)) release(id, { stopRuns: true })
    void history.remove(id)
  }
  const clearSaved = () => {
    for (const c of background) release(c.id, { stopRuns: true })
    void history.clearAll()
  }

  // A share link opens as a new local chat, saved like any other.
  useSharedLink({
    onOpen: (payload) => {
      const opened = chatFromShare(payload, newId('chat'), Date.now())
      chat.load(opened.chat)
      setDraft(opened.draft ?? '')
      // A proposal has its own banner, which also says when a proposed model isn't available.
      setNotice(payload.proposal ? undefined : { kind: 'shared', model: payload.columns[0]!.settings.model })
    },
    onDamaged: () => setNotice({ kind: 'damaged' }),
  })

  useShortcuts({
    runAgain: () => canRunAgainIn(focused) && chat.runAgain(focused.id),
    stop: () => chat.stop(),
    newChat,
    showShortcuts: () => setDialog('shortcuts'),
    openModelPicker: () => openModelPicker(),
    isStreaming,
  })

  // What error cards and countdowns in one panel can do. `runAgain` is only offered on its last answer.
  const actionsFor = (col: Column): RunActions => ({
    ...(canRunAgainIn(col) ? { runAgain: (overrides?: Partial<typeof col.settings>) => chat.runAgain(col.id, overrides) } : {}),
    switchModel: () => openModelPicker(col.id),
    newChat,
    stop: () => chat.stop(col.id),
    appVersion: health?.version ?? 'unknown',
  })

  const perPanel = panelUsages(columns)
  const promptTokensFor = (col: Column) => estimatePromptTokens(col.messages.map((m) => m.text).join('') + draft)
  /** In tabs: an agent's name for the choice, else the model. */
  const columnName = (col: Column) => col.proposed?.label ?? nameOf(col.settings.model)

  const settingsSidebar = (onClose: () => void) => (
    <SettingsSidebar canReset={columns.some((col) => anyChanged(col.settings))} onReset={() => columns.forEach((col) => chat.resetSettings(col.id))} onClose={onClose}>
      <SettingsPanel
        // Fresh per mode, so a half-typed value doesn't carry across.
        key={comparing ? 'compare' : 'single'}
        settings={colA.settings}
        onChange={editColumn(colA)}
        promptTokens={promptTokensFor(colA)}
        {...(colB ? { b: { settings: colB.settings, onChange: editColumn(colB), promptTokens: promptTokensFor(colB) } } : {})}
        onValidityChange={setSettingsValid}
        models={models}
      />
    </SettingsSidebar>
  )

  const historyPanel = (inDrawer: boolean) => (
    <HistoryPanel
      chats={history.chats}
      openChatId={chat.state.id}
      problem={history.problem}
      deleted={history.deleted}
      generating={generating}
      nameOf={nameOf}
      onOpen={openSaved}
      onDelete={deleteSaved}
      onUndo={() => void history.undo()}
      onClearAll={clearSaved}
      onNewChat={newChat}
      canStartNew={columns.some((col) => col.messages.length > 0)}
      {...(inDrawer ? { onClose: () => layout.history.setDrawerOpen(false) } : {})}
      onDismissProblem={history.dismissProblem}
    />
  )

  return (
    <div className="flex h-dvh flex-col">
      <AppHeader onAgent={() => setDialog('agent')} onCode={() => setDialog('code')} onShare={() => setDialog('share')} onShortcuts={() => setDialog('shortcuts')} />

      {(modelsError || refreshError) && (
        <div role="status" className="flex flex-wrap items-center justify-between gap-2 border-b border-amber-200 bg-amber-50 px-4 py-1.5 text-xs text-amber-900 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-200">
          <p>
            {modelsError
              ? `Couldn't load the model list: ${modelsError.message}`
              : `Couldn't refresh the model list, so the saved one is in use: ${refreshError?.message}`}
          </p>
          <button type="button" onClick={refresh} disabled={refreshing} className="shrink-0 rounded px-1 py-0.5 font-medium underline underline-offset-2 hover:no-underline disabled:cursor-wait disabled:opacity-60">
            {refreshing ? 'Retrying…' : 'Retry model list'}
          </button>
        </div>
      )}

      <div className="flex min-h-0 flex-1">
        {layout.history.sidebar && (
          <aside className="relative w-64 shrink-0 border-r border-slate-200 dark:border-slate-800">
            {historyPanel(false)}
            <HistoryHandle open onClick={layout.history.toggle} takeFocus={layout.history.handleTakesFocus} />
          </aside>
        )}

        <main className="relative flex min-w-0 flex-1 flex-col">
          {/* Folded, or on a narrow screen: a tab on the left edge brings history back. */}
          {!layout.history.sidebar && <HistoryHandle open={false} onClick={layout.history.toggle} takeFocus={layout.history.handleTakesFocus} />}
          {chat.state.proposal && (
            <ProposalBanner
              // Fresh per chat, so whether it starts open follows that chat.
              key={chat.state.id}
              proposal={chat.state.proposal}
              columns={columns}
              nameOf={nameOf}
              isAvailable={(id) => models.length === 0 || models.some((m) => m.id === id)}
              onDismiss={chat.clearProposal}
            />
          )}

          <ChatPanels columns={columns} focusedId={focused.id} onFocus={setFocusedId} sideBySide={layout.sideBySide} tabName={columnName}>
            {(col, i) => (
              <>
                {comparing && (
                  <ColumnHeader
                    label={panelLabel(i)}
                    modelName={nameOf(col.settings.model)}
                    differences={panelDifferences(differing, col.settings)}
                    focused={col.id === focused.id}
                    streaming={isBusy(col)}
                    usage={perPanel[i]!.tokens > 0 ? formatUsage(perPanel[i]!) : []}
                    {...(col.proposed ? { choice: { label: col.proposed.label, changed: changedSinceProposed(col) } } : {})}
                    onStop={() => chat.stop(col.id)}
                  />
                )}
                <ColumnView
                  column={col}
                  actions={actionsFor(col)}
                  canRunAgain={canRunAgainIn(col)}
                  nameOf={nameOf}
                  top={i === 0 && notice ? <NoticeBar notice={notice} nameOf={nameOf} onDismiss={() => setNotice(undefined)} onNewChat={newChat} /> : undefined}
                  empty={
                    // While the last chat is being reopened after a reload, show nothing rather than flash the welcome.
                    comparing || history.restoring ? null : <EmptyState onPick={(text) => run(text)} disabled={Boolean(blockedReason)} />
                  }
                />
              </>
            )}
          </ChatPanels>

          <PromptBox
            draft={draft}
            onDraftChange={setDraft}
            onRun={() => run()}
            onStop={() => chat.stop()}
            streaming={isStreaming}
            blockedReason={blockedReason}
            columns={columns}
            onModeChange={changeMode}
            models={models}
            modelsLoading={loading}
            pricesAsOf={pricesAsOf}
            pickerOpenFor={pickerOpen ? focused.id : null}
            onPickerOpenChange={(columnId, open) => {
              if (open) setFocusedId(columnId)
              setPickerOpen(open)
            }}
            onModelChange={(columnId, model) => {
              chat.updateSettings(columnId, { model })
              rememberModel(model)
            }}
            settingsShown={layout.settings.shown}
            onToggleSettings={layout.settings.toggle}
            usage={chatUsage(columns)}
          />
        </main>

        {layout.settings.sidebar && <aside className="w-80 shrink-0 border-l border-slate-200 dark:border-slate-800">{settingsSidebar(layout.settings.closeSidebar)}</aside>}
      </div>

      {!layout.wide && (
        <Dialog open={layout.history.drawerOpen} onOpenChange={layout.history.setDrawerOpen} title="History" placement="left">
          {historyPanel(true)}
        </Dialog>
      )}
      {!layout.wide && (
        <Dialog open={layout.settings.drawerOpen} onOpenChange={layout.settings.setDrawerOpen} title="Settings" placement="right">
          {settingsSidebar(() => layout.settings.setDrawerOpen(false))}
        </Dialog>
      )}
      <ShareDialog {...dialogProps('share')} chat={chat.state} draft={draft} />
      <CodeDialog {...dialogProps('code')} columns={columns} focusedId={focused.id} draft={draft} columnName={columnName} />
      <ShortcutsDialog {...dialogProps('shortcuts')} />
      <ConnectAgentDialog {...dialogProps('agent')} />
      {DEBUG && (
        <Suspense fallback={null}>
          <WeatherControl preset={weather} onChange={setWeather} faultsEnabled={health?.faultsEnabled} />
        </Suspense>
      )}
    </div>
  )
}
