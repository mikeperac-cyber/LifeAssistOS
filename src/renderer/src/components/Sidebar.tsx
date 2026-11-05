import { useEffect, useRef, useState } from 'react'
import type { FolderGrant } from '../../../shared/types'
import { NAV_GROUPS, shouldHandleNavigationShortcut, VIEW_META, type View } from '../navigation'

export type { View } from '../navigation'

export function Sidebar({
  view,
  onChange,
  auditCount,
  grants,
  model,
  preset,
  onQuickCapture
}: {
  view: View
  onChange: (view: View) => void
  auditCount: number
  grants: FolderGrant[]
  model: string
  preset: string
  onQuickCapture: () => void
}): React.JSX.Element {
  const [navQuery, setNavQuery] = useState('')
  const navSearchRef = useRef<HTMLInputElement>(null)
  const normalizedQuery = navQuery.trim().toLocaleLowerCase()
  const visibleGroups = NAV_GROUPS.map((group) => ({
    ...group,
    items: group.items.filter((item) => {
      const label = VIEW_META[item].label === 'Assistant' ? 'Chat' : VIEW_META[item].label
      return !normalizedQuery ||
        label.toLocaleLowerCase().includes(normalizedQuery) ||
        VIEW_META[item].label.toLocaleLowerCase().includes(normalizedQuery) ||
        group.label.toLocaleLowerCase().includes(normalizedQuery)
    })
  })).filter((group) => group.items.length > 0)
  const firstVisibleView = visibleGroups[0]?.items[0]

  useEffect(() => {
    const handleShortcut = (event: KeyboardEvent): void => {
      const target = event.target instanceof Element ? event.target : null
      const focusIsProtected = target !== null && target !== navSearchRef.current &&
        target.closest('input, textarea, select, [contenteditable="true"], [role="dialog"], dialog') !== null
      if (!shouldHandleNavigationShortcut(event, focusIsProtected)) return

      event.preventDefault()
      setNavQuery('')
      navSearchRef.current?.focus()
    }
    window.addEventListener('keydown', handleShortcut)
    return () => window.removeEventListener('keydown', handleShortcut)
  }, [])

  return (
    <aside className="sidebar">
      <div className="brand">
        <div className="brand-mark">M</div>
        <div className="brand-text">
          <span className="brand-name">Mike Assist</span>
          <span className="brand-sub">Local · permission-gated</span>
        </div>
      </div>

      <div className="nav-search-wrap" role="search">
        <SearchIcon />
        <input
          ref={navSearchRef}
          type="search"
          value={navQuery}
          placeholder="Find a section"
          aria-label="Find a section"
          aria-keyshortcuts="Control+K Meta+K"
          onChange={(event) => setNavQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Escape' && navQuery) {
              event.preventDefault()
              setNavQuery('')
              return
            }
            if (event.key === 'Enter' && firstVisibleView) {
              event.preventDefault()
              onChange(firstVisibleView)
              setNavQuery('')
            }
          }}
        />
        <kbd className="nav-shortcut">Ctrl K</kbd>
      </div>

      <button
        type="button"
        className="quick-capture-trigger ghost-button"
        onClick={onQuickCapture}
        aria-keyshortcuts="Control+Shift+K Meta+Shift+K"
        title="Save a thought to the Today inbox"
      >
        <span aria-hidden="true">＋</span>
        <span>Quick capture</span>
        <kbd className="quick-capture-shortcut">Ctrl ⇧ K</kbd>
      </button>

      <nav className="nav" aria-label="Main navigation">
        {visibleGroups.length === 0 && <p className="nav-empty" role="status">No matching sections.</p>}
        {visibleGroups.map((group) => (
          <div className="nav-group" key={group.label}>
            <span className="nav-group-label">{group.label}</span>
            {group.items.map((item) => (
              <button
                type="button"
                key={item}
                className={`nav-button ${view === item ? 'active' : ''}`}
                aria-current={view === item ? 'page' : undefined}
                title={VIEW_META[item].label}
                onClick={() => {
                  onChange(item)
                  setNavQuery('')
                }}
              >
                {iconForView(item)}
                <span>{VIEW_META[item].label === 'Assistant' ? 'Chat' : VIEW_META[item].label}</span>
                {item === 'activity' && auditCount > 0 && (
                  <span className="nav-count">{auditCount > 999 ? '999+' : auditCount}</span>
                )}
              </button>
            ))}
          </div>
        ))}
      </nav>

      <div className="sidebar-spacer" />

      <div className="side-card">
        <div className="side-label">
          <FolderIcon />
          Approved folders
          <button className="side-link" type="button" onClick={() => onChange('settings')}>
            Manage
          </button>
        </div>
        <ul className="folder-list">
          {grants.length === 0 && <li className="muted">None yet.</li>}
          {grants.slice(0, 5).map((grant) => (
            <li key={grant.id} title={grant.root}>
              <span className="folder-name">{grant.label}</span>
              <span className={`access-badge access-${grant.access}`}>
                {grant.access === 'read-write' ? 'rw' : 'read'}
              </span>
            </li>
          ))}
        </ul>
      </div>

      <div className="side-card">
        <div className="side-label">
          <ShieldIcon />
          Gateway rules
        </div>
        <ul className="rules">
          <li>
            <span className="dot dot-green" />
            <span>Read</span>
            <span className="rule-value">allow</span>
          </li>
          <li>
            <span className="dot dot-amber" />
            <span>Write</span>
            <span className="rule-value">ask</span>
          </li>
          <li>
            <span className="dot dot-blue" />
            <span>Web page fetch</span>
            <span className="rule-value">allowlist</span>
          </li>
          <li>
            <span className="dot dot-amber" />
            <span>External actions</span>
            <span className="rule-value">ask</span>
          </li>
          <li>
            <span className="dot dot-red" />
            <span>Destructive · privileged</span>
            <span className="rule-value">block</span>
          </li>
        </ul>
      </div>

      <div className="sidebar-foot" title={model}>
        {preset || 'No provider'} · {model || 'not configured'}
      </div>
    </aside>
  )
}

function iconForView(view: View): React.JSX.Element {
  if (view === 'chat') return <ChatIcon />
  if (view === 'memory') return <MemoryIcon />
  if (view === 'finances') return <FinanceIcon />
  if (view === 'workflows') return <WorkflowIcon />
  if (view === 'settings') return <SettingsIcon />
  if (view === 'activity') return <AuditIcon />

  const glyphs: Record<Exclude<View, 'chat' | 'memory' | 'finances' | 'workflows' | 'settings' | 'activity'>, string> = {
    coach: '✧',
    today: '◷',
    scheduled: '◴',
    research: '⌕',
    vault: '▣',
    teaching: '✦',
    integrations: '⌘',
    skills: '✧'
  }
  return <span className="nav-glyph" aria-hidden="true">{glyphs[view]}</span>
}

function FinanceIcon(): React.JSX.Element {
  return (
    <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M4 19V5M4 19h16" />
      <path d="m7 15 3-4 3 2 5-7" />
      <circle cx="18" cy="6" r="1.3" fill="currentColor" stroke="none" />
    </svg>
  )
}

function WorkflowIcon(): React.JSX.Element {
  return (
    <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="6" cy="6" r="2" />
      <circle cx="18" cy="18" r="2" />
      <path d="M8 6h5a3 3 0 0 1 3 3v6" />
      <path d="M10 12H6v4" />
      <path d="m14 13 2 2 2-2" />
    </svg>
  )
}

function MemoryIcon(): React.JSX.Element {
  return (
    <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 3a6 6 0 0 1 6 6v2h-2a2 2 0 0 0 0 4h2" />
      <path d="M5 9a3 3 0 0 1 3-3" />
      <circle cx="6" cy="13" r="4" />
      <path d="M10 13v8" />
    </svg>
  )
}

function ChatIcon(): React.JSX.Element {
  return (
    <svg
      viewBox="0 0 24 24"
      width="17"
      height="17"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M21 12a8 8 0 0 1-8 8H7l-4 3v-6.5A8 8 0 1 1 21 12Z" />
    </svg>
  )
}

function SettingsIcon(): React.JSX.Element {
  return (
    <svg
      viewBox="0 0 24 24"
      width="17"
      height="17"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.7 1.7 0 0 0 .34 1.87l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.7 1.7 0 0 0-1.87-.34 1.7 1.7 0 0 0-1 1.55V21a2 2 0 1 1-4 0v-.09a1.7 1.7 0 0 0-1.11-1.55 1.7 1.7 0 0 0-1.87.34l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.7 1.7 0 0 0 4.6 15a1.7 1.7 0 0 0-1.55-1H3a2 2 0 1 1 0-4h.09A1.7 1.7 0 0 0 4.6 8.9a1.7 1.7 0 0 0-.34-1.87l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.7 1.7 0 0 0 8.96 4.6 1.7 1.7 0 0 0 10 3.05V3a2 2 0 1 1 4 0v.09a1.7 1.7 0 0 0 1 1.55 1.7 1.7 0 0 0 1.87-.34l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.7 1.7 0 0 0-.34 1.87V9a1.7 1.7 0 0 0 1.55 1H21a2 2 0 1 1 0 4h-.09a1.7 1.7 0 0 0-1.51 1Z" />
    </svg>
  )
}

function AuditIcon(): React.JSX.Element {
  return (
    <svg
      viewBox="0 0 24 24"
      width="17"
      height="17"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M7 3h8l4 4v14H7z" />
      <path d="M15 3v4h4" />
      <path d="M10 12h6M10 16h6" />
    </svg>
  )
}

function SearchIcon(): React.JSX.Element {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
      <circle cx="10.8" cy="10.8" r="6.3" />
      <path d="m16 16 4 4" />
    </svg>
  )
}

function FolderIcon(): React.JSX.Element {
  return (
    <svg
      viewBox="0 0 24 24"
      width="14"
      height="14"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
    </svg>
  )
}

function ShieldIcon(): React.JSX.Element {
  return (
    <svg
      viewBox="0 0 24 24"
      width="14"
      height="14"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M12 3 5 6v5c0 4.5 3 8 7 10 4-2 7-5.5 7-10V6z" />
      <path d="m9 12 2 2 4-4" />
    </svg>
  )
}
