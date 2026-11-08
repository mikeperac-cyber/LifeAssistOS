import { useCallback, useEffect, useState } from 'react'
import type { PublicSettings } from '../../shared/ipc'
import { QuickCaptureDialog } from './components/QuickCaptureDialog'
import { SettingsView } from './components/SettingsView'
import { Sidebar } from './components/Sidebar'
import { TodoView } from './components/TodoView'
import { DEFAULT_VIEW, normalizeView, readSidebarVisibility, SIDEBAR_VISIBILITY_STORAGE_KEY, VIEW_META, shouldHandleQuickCaptureShortcut, type SidebarVisibility, type View } from './navigation'
import { applyAppTheme, getSavedAppTheme, APP_THEME_STORAGE_KEY, type AppTheme } from './theme'

const SAVED_VIEW_STORAGE_KEY = 'mike-assist-view'

export default function App(): React.JSX.Element {
  const [view, setView] = useState<View>(readSavedView)
  const [sidebarVisibility, setSidebarVisibility] = useState<SidebarVisibility>(() =>
    readSidebarVisibility((key) => window.localStorage.getItem(key))
  )
  const [appTheme, setAppTheme] = useState<AppTheme>(getSavedAppTheme)
  const [settings, setSettings] = useState<PublicSettings | null>(null)
  const [settingsLoading, setSettingsLoading] = useState(true)
  const [settingsError, setSettingsError] = useState('')
  const [quickCaptureOpen, setQuickCaptureOpen] = useState(false)
  const [taskRefreshVersion, setTaskRefreshVersion] = useState(0)
  const [appWarning, setAppWarning] = useState('')

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
      else if (event.type === 'warning') setAppWarning(event.message)
      else if (event.type === 'today_changed') setTaskRefreshVersion((version) => version + 1)
    })
    return unsubscribe
  }, [])

  useEffect(() => {
    const handleQuickCaptureShortcut = (event: KeyboardEvent): void => {
      const target = event.target instanceof Element ? event.target : null
      const protectedFocus = target !== null && target.closest('input, textarea, select, [contenteditable="true"], [role="dialog"], dialog') !== null
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
    try { window.localStorage.setItem(SAVED_VIEW_STORAGE_KEY, view) } catch { /* The Tasks screen remains the default after restart. */ }
  }, [view])

  const navigateToView = (nextView: View): void => setView(normalizeView(nextView))

  return (
    <div className={`app ${sidebarVisibility === 'closed' ? 'sidebar-closed' : ''}`}>
      <Sidebar
        sidebarVisibility={sidebarVisibility}
        onToggleSidebar={() => setSidebarVisibility((current) => current === 'open' ? 'closed' : 'open')}
        view={view}
        onChange={navigateToView}
        onQuickCapture={() => setQuickCaptureOpen(true)}
      />
      <main className="main">
        <header className="topbar">
          {sidebarVisibility === 'closed' && (
            <button
              type="button"
              className="sidebar-toggle-button sidebar-open-button"
              aria-controls="app-sidebar"
              aria-expanded="false"
              onClick={() => setSidebarVisibility('open')}
            >
              <span aria-hidden="true">☰</span>
              Open sidebar
            </button>
          )}
          <div className="topbar-titles">
            <h1>{VIEW_META[view].label}</h1>
            <p>{VIEW_META[view].description}</p>
          </div>
        </header>

        {appWarning && <p className="startup-load-notice has-error" role="alert">{appWarning}</p>}
        {view === 'tasks' && (
          <TodoView refreshVersion={taskRefreshVersion} onQuickCapture={() => setQuickCaptureOpen(true)} />
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
            {!settingsLoading && settings && (
              <SettingsView
                settings={settings}
                onSettingsUpdated={setSettings}
                theme={appTheme}
                onThemeChange={setAppTheme}
              />
            )}
          </section>
        )}
      </main>
      <QuickCaptureDialog open={quickCaptureOpen} onClose={() => setQuickCaptureOpen(false)} onCaptured={() => setTaskRefreshVersion((version) => version + 1)} />
    </div>
  )
}

function readSavedView(): View {
  try { return normalizeView(window.localStorage.getItem(SAVED_VIEW_STORAGE_KEY) ?? DEFAULT_VIEW) } catch { return DEFAULT_VIEW }
}
