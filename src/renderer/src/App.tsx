import { lazy, Suspense, useCallback, useEffect, useState } from 'react'
import type { PublicSettings } from '../../shared/ipc'
import { QuickCaptureDialog } from './components/QuickCaptureDialog'
import { Sidebar } from './components/Sidebar'
import { TodoView } from './components/TodoView'
import { Icon } from './components/Icon'
import { DEFAULT_VIEW, normalizeView, readSidebarVisibility, SIDEBAR_VISIBILITY_STORAGE_KEY, VIEW_META, shouldHandleQuickCaptureShortcut, type SidebarVisibility, type View } from './navigation'
import { applyAppTheme, getSavedAppTheme, APP_THEME_STORAGE_KEY, type AppTheme } from './theme'
import type { ReviewTaskFilter } from './components/review-view-model'

const SAVED_VIEW_STORAGE_KEY = 'mike-assist-view'
const SettingsView = lazy(() => import('./components/SettingsView').then((module) => ({ default: module.SettingsView })))
const ProjectsView = lazy(() => import('./components/ProjectsView').then((module) => ({ default: module.ProjectsView })))
const ReviewView = lazy(() => import('./components/ReviewView').then((module) => ({ default: module.ReviewView })))
const AssistantView = lazy(() => import('./components/AssistantView').then((module) => ({ default: module.AssistantView })))
const LifeView = lazy(() => import('./components/LifeView').then((module) => ({ default: module.LifeView })))

export default function App(): React.JSX.Element {
  const [view, setView] = useState<View>(readSavedView)
  const [assistantVisited, setAssistantVisited] = useState(() => readSavedView() === 'assistant')
  const [sidebarVisibility, setSidebarVisibility] = useState<SidebarVisibility>(() =>
    readSidebarVisibility((key) => window.localStorage.getItem(key))
  )
  const [appTheme, setAppTheme] = useState<AppTheme>(getSavedAppTheme)
  const [settings, setSettings] = useState<PublicSettings | null>(null)
  const [settingsLoading, setSettingsLoading] = useState(true)
  const [settingsError, setSettingsError] = useState('')
  const [quickCaptureOpen, setQuickCaptureOpen] = useState(false)
  const [commandOpen, setCommandOpen] = useState(false)
  const [taskRefreshVersion, setTaskRefreshVersion] = useState(0)
  const [taskLandingFilter, setTaskLandingFilter] = useState<ReviewTaskFilter>('my-day')
  const [assistantPrompt, setAssistantPrompt] = useState('')

  const loadSettings = useCallback(async (): Promise<void> => {
    setSettingsLoading(true)
    setSettingsError('')
    try {
      setSettings(await window.assist.getSettings())
    } catch (error) {
      setSettingsError(error instanceof Error ? error.message : String(error))
    } finally {
      setSettingsLoading(false)
    }
  }, [])

  useEffect(() => { void loadSettings() }, [loadSettings])

  useEffect(() => {
    const unsubscribe = window.assist.onEvent((event) => {
      if (event.type === 'quick_capture_requested') setQuickCaptureOpen(true)
      else if (event.type === 'today_changed') setTaskRefreshVersion((version) => version + 1)
    })
    return unsubscribe
  }, [])

  useEffect(() => {
    const handleQuickCaptureShortcut = (event: KeyboardEvent): void => {
      const target = event.target instanceof Element ? event.target : null
      const protectedFocus = target !== null && target.closest('input, textarea, select, [contenteditable="true"], [role="dialog"], dialog') !== null
      if (!protectedFocus && !event.defaultPrevented && !event.altKey && (event.ctrlKey || event.metaKey) && !event.shiftKey && event.key.toLocaleLowerCase() === 'k') {
        event.preventDefault(); setCommandOpen(true); return
      }
      if (!shouldHandleQuickCaptureShortcut(event, protectedFocus)) return
      event.preventDefault()
      setQuickCaptureOpen(true)
    }
    window.addEventListener('keydown', handleQuickCaptureShortcut)
    return () => window.removeEventListener('keydown', handleQuickCaptureShortcut)
  }, [])

  useEffect(() => {
    applyAppTheme(document.documentElement, appTheme)
    try { window.localStorage.setItem(APP_THEME_STORAGE_KEY, appTheme) } catch { /* Keep this session's theme active. */ }
  }, [appTheme])

  useEffect(() => {
    try { window.localStorage.setItem(SIDEBAR_VISIBILITY_STORAGE_KEY, sidebarVisibility) } catch { /* Keep this session's layout active. */ }
  }, [sidebarVisibility])

  useEffect(() => {
    try { window.localStorage.setItem(SAVED_VIEW_STORAGE_KEY, view) } catch { /* Keep this session's view active. */ }
  }, [view])

  const navigateToView = (nextView: View): void => {
    const normalized = normalizeView(nextView)
    if (normalized === 'tasks') setTaskLandingFilter('my-day')
    if (normalized === 'assistant') setAssistantVisited(true)
    setView(normalized)
  }

  const openTasksAt = (filter: ReviewTaskFilter): void => {
    setTaskLandingFilter(filter)
    setView('tasks')
  }

  return (
    <div className={`app ${sidebarVisibility === 'closed' ? 'sidebar-closed' : ''}`}>
      <Sidebar
        sidebarVisibility={sidebarVisibility}
        onToggleSidebar={() => setSidebarVisibility((current) => current === 'open' ? 'closed' : 'open')}
        view={view}
        onChange={navigateToView}
      />
      <main className="main">
        <header className={`topbar${view === 'assistant' ? ' assistant-topbar' : ''}`}>
          {sidebarVisibility === 'closed' && (
            <button
              type="button"
              className="sidebar-toggle-button sidebar-open-button"
              aria-controls="app-sidebar"
              aria-expanded="false"
              onClick={() => setSidebarVisibility('open')}
            >
              <Icon name="menu" />
              Open sidebar
            </button>
          )}
          {view !== 'assistant' && <div className="topbar-titles">
            <h1>{VIEW_META[view].label}</h1>
            <p>{VIEW_META[view].description}</p>
          </div>}
          <div className="topbar-actions">
            <button
              type="button"
              className="command-trigger"
              aria-label="Jump to…"
              aria-keyshortcuts="Control+K Meta+K"
              onClick={() => setCommandOpen(true)}
            >
              <Icon name="search" />
              <span>Jump to…</span>
              <kbd aria-hidden="true">Ctrl K</kbd>
            </button>
            <button
              type="button"
              className="create-trigger"
              aria-keyshortcuts="Control+Shift+K Meta+Shift+K"
              title="Save a thought to the Inbox"
              onClick={() => setQuickCaptureOpen(true)}
            >
              <Icon name="plus" />
              Create
            </button>
          </div>
        </header>

        {view === 'tasks' && (
          <TodoView
            refreshVersion={taskRefreshVersion}
            initialFilter={taskLandingFilter}
            onQuickCapture={() => setQuickCaptureOpen(true)}
            settings={settings}
            onOpenSettings={() => navigateToView('settings')}
            onOpenLife={() => navigateToView('life')}
          />
        )}
        {assistantVisited && <Suspense fallback={<ViewLoading label="Opening Assistant…" />}><AssistantView
          visible={view === 'assistant'}
          settings={settings}
          refreshVersion={taskRefreshVersion}
          initialPrompt={assistantPrompt}
          onInitialPromptConsumed={() => setAssistantPrompt('')}
          onOpenSettings={() => navigateToView('settings')}
        /></Suspense>}
        {view === 'review' && (
          <Suspense fallback={<ViewLoading label="Opening Review…" />}><ReviewView
            refreshVersion={taskRefreshVersion}
            onOpenTasks={openTasksAt}
            onOpenProjects={() => setView('projects')}
            onOpenAssistant={(prompt) => { setAssistantPrompt(prompt); navigateToView('assistant') }}
            onQuickCapture={() => setQuickCaptureOpen(true)}
          /></Suspense>
        )}
        {view === 'projects' && <Suspense fallback={<ViewLoading label="Opening Projects…" />}><ProjectsView /></Suspense>}
        {view === 'life' && (
          <Suspense fallback={<ViewLoading label="Opening Dashboard…" />}>
            <LifeView
              refreshVersion={taskRefreshVersion}
              onOpenTasks={() => navigateToView('tasks')}
              onOpenUpcomingTasks={() => openTasksAt('due-week')}
              onOpenProjects={() => navigateToView('projects')}
            />
          </Suspense>
        )}
        {view === 'settings' && (
          <section className="settings-content">
            {settingsLoading && <p className="muted" role="status">Loading settings…</p>}
            {!settingsLoading && settingsError && (
              <div className="startup-load-notice has-error" role="alert">
                <p>{settingsError}</p>
                <button className="ghost-button" type="button" onClick={() => void loadSettings()}>Retry</button>
              </div>
            )}
            {!settingsLoading && settings && <Suspense fallback={<ViewLoading label="Opening Settings…" />}>
              <SettingsView
                settings={settings}
                onSettingsUpdated={setSettings}
                theme={appTheme}
                onThemeChange={setAppTheme}
              />
            </Suspense>}
          </section>
        )}
      </main>
      <QuickCaptureDialog open={quickCaptureOpen} onClose={() => setQuickCaptureOpen(false)} onCaptured={() => setTaskRefreshVersion((version) => version + 1)} />
      <CommandPalette open={commandOpen} onClose={() => setCommandOpen(false)} onCapture={() => { setCommandOpen(false); setQuickCaptureOpen(true) }} onNavigate={(nextView) => { setCommandOpen(false); navigateToView(nextView) }} />
    </div>
  )
}

function ViewLoading({ label }: { label: string }): React.JSX.Element {
  return <p className="view-loading" role="status" aria-live="polite">{label}</p>
}

function CommandPalette({ open, onClose, onCapture, onNavigate }: { open: boolean; onClose: () => void; onCapture: () => void; onNavigate: (view: View) => void }): React.JSX.Element | null {
  const [query, setQuery] = useState('')
  const [activeIndex, setActiveIndex] = useState(0)
  useEffect(() => { if (open) { setQuery(''); setActiveIndex(0) } }, [open])
  if (!open) return null
  const actions = [
    ...Object.entries(VIEW_META).map(([id, meta]) => ({ title: `Open ${meta.label}`, detail: meta.description, run: () => onNavigate(id as View) })),
    { title: 'Capture a thought', detail: 'Add something to your Inbox', run: onCapture }
  ]
  const visible = actions.filter((action) => `${action.title} ${action.detail}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()))
  const moveActive = (direction: number): void => {
    if (visible.length) setActiveIndex((index) => (index + direction + visible.length) % visible.length)
  }
  const handleSearchKeyDown = (event: React.KeyboardEvent<HTMLInputElement>): void => {
    if (event.key === 'ArrowDown') { event.preventDefault(); moveActive(1) }
    else if (event.key === 'ArrowUp') { event.preventDefault(); moveActive(-1) }
    else if (event.key === 'Enter' && visible[activeIndex]) { event.preventDefault(); visible[activeIndex].run() }
    else if (event.key === 'Escape') { event.preventDefault(); onClose() }
  }
  return <div className="command-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}>
    <section className="command-palette" role="dialog" aria-modal="true" aria-label="Command palette">
      <label className="command-search"><Icon name="search" /><input autoFocus value={query} onKeyDown={handleSearchKeyDown} onChange={(event) => { setQuery(event.target.value); setActiveIndex(0) }} placeholder="Where would you like to go?" aria-label="Search commands" aria-controls="command-options" aria-activedescendant={visible[activeIndex] ? `command-option-${activeIndex}` : undefined} /><kbd>ESC</kbd></label>
      <div className="command-results" id="command-options" role="listbox" aria-label="Commands">{visible.length ? visible.map((action, index) => <button id={`command-option-${index}`} type="button" role="option" aria-selected={activeIndex === index} key={action.title} onMouseEnter={() => setActiveIndex(index)} onClick={action.run}><span><strong>{action.title}</strong><small>{action.detail}</small></span><Icon name="arrow" /></button>) : <p>No matching commands</p>}</div>
      <footer><span><kbd>Ctrl</kbd> <kbd>K</kbd> to open</span><span>Quick actions</span></footer>
    </section>
  </div>
}

function readSavedView(): View {
  try { return normalizeView(window.localStorage.getItem(SAVED_VIEW_STORAGE_KEY) ?? DEFAULT_VIEW) } catch { return DEFAULT_VIEW }
}
