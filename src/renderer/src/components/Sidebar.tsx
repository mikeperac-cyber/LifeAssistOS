import type { FolderGrant } from '../../../shared/types'

export type View = 'chat' | 'coach' | 'today' | 'scheduled' | 'research' | 'vault' | 'teaching' | 'integrations' | 'memory' | 'activity' | 'finances' | 'workflows' | 'skills' | 'settings'

export function Sidebar({
  view,
  onChange,
  auditCount,
  grants,
  model,
  preset
}: {
  view: View
  onChange: (view: View) => void
  auditCount: number
  grants: FolderGrant[]
  model: string
  preset: string
}): React.JSX.Element {
  return (
    <aside className="sidebar">
      <div className="brand">
        <div className="brand-mark">M</div>
        <div className="brand-text">
          <span className="brand-name">Mike Assist</span>
          <span className="brand-sub">Local · permission-gated</span>
        </div>
      </div>

      <nav className="nav" aria-label="Main">
        <button
          type="button"
          className={`nav-button ${view === 'chat' ? 'active' : ''}`}
          aria-current={view === 'chat' ? 'page' : undefined}
          onClick={() => onChange('chat')}
        >
          <ChatIcon />
          <span>Chat</span>
        </button>
        <button
          type="button"
          className={`nav-button ${view === 'memory' ? 'active' : ''}`}
          aria-current={view === 'memory' ? 'page' : undefined}
          onClick={() => onChange('memory')}
        >
          <MemoryIcon />
          <span>Memory</span>
        </button>
        <button type="button" className={`nav-button ${view === 'coach' ? 'active' : ''}`} aria-current={view === 'coach' ? 'page' : undefined} onClick={() => onChange('coach')}>
          <span className="nav-glyph" aria-hidden="true">✧</span><span>Coach</span>
        </button>
        <button type="button" className={`nav-button ${view === 'today' ? 'active' : ''}`} aria-current={view === 'today' ? 'page' : undefined} onClick={() => onChange('today')}>
          <span className="nav-glyph" aria-hidden="true">◷</span><span>Today</span>
        </button>
        <button type="button" className={`nav-button ${view === 'scheduled' ? 'active' : ''}`} aria-current={view === 'scheduled' ? 'page' : undefined} onClick={() => onChange('scheduled')}>
          <span className="nav-glyph" aria-hidden="true">◴</span><span>Scheduled</span>
        </button>
        <button type="button" className={`nav-button ${view === 'research' ? 'active' : ''}`} aria-current={view === 'research' ? 'page' : undefined} onClick={() => onChange('research')}>
          <span className="nav-glyph" aria-hidden="true">⌕</span><span>Research</span>
        </button>
        <button type="button" className={`nav-button ${view === 'vault' ? 'active' : ''}`} aria-current={view === 'vault' ? 'page' : undefined} onClick={() => onChange('vault')}>
          <span className="nav-glyph" aria-hidden="true">▣</span><span>Vault</span>
        </button>
        <button type="button" className={`nav-button ${view === 'teaching' ? 'active' : ''}`} aria-current={view === 'teaching' ? 'page' : undefined} onClick={() => onChange('teaching')}>
          <span className="nav-glyph" aria-hidden="true">✦</span><span>LB English</span>
        </button>
        <button type="button" className={`nav-button ${view === 'integrations' ? 'active' : ''}`} aria-current={view === 'integrations' ? 'page' : undefined} onClick={() => onChange('integrations')}>
          <span className="nav-glyph" aria-hidden="true">⌘</span><span>Integrations</span>
        </button>
        <button
          type="button"
          className={`nav-button ${view === 'finances' ? 'active' : ''}`}
          aria-current={view === 'finances' ? 'page' : undefined}
          onClick={() => onChange('finances')}
        >
          <FinanceIcon />
          <span>Finances</span>
        </button>
        <button
          type="button"
          className={`nav-button ${view === 'workflows' ? 'active' : ''}`}
          aria-current={view === 'workflows' ? 'page' : undefined}
          onClick={() => onChange('workflows')}
        >
          <WorkflowIcon />
          <span>Workflows</span>
        </button>
        <button type="button" className={`nav-button ${view === 'skills' ? 'active' : ''}`} aria-current={view === 'skills' ? 'page' : undefined} onClick={() => onChange('skills')}>
          <span className="nav-glyph" aria-hidden="true">✧</span><span>Skills</span>
        </button>
        <button
          type="button"
          className={`nav-button ${view === 'settings' ? 'active' : ''}`}
          aria-current={view === 'settings' ? 'page' : undefined}
          onClick={() => onChange('settings')}
        >
          <SettingsIcon />
          <span>Settings</span>
        </button>
        <button
          type="button"
          className={`nav-button ${view === 'activity' ? 'active' : ''}`}
          aria-current={view === 'activity' ? 'page' : undefined}
          onClick={() => onChange('activity')}
        >
          <AuditIcon />
          <span>Activity</span>
          {auditCount > 0 && <span className="nav-count">{auditCount > 999 ? '999+' : auditCount}</span>}
        </button>
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
