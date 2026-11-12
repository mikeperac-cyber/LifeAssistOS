import type { SidebarVisibility, View } from '../navigation'
import { NAV_GROUPS, VIEW_META } from '../navigation'
import { Icon } from './Icon'

export type { View } from '../navigation'

export function Sidebar({
  sidebarVisibility,
  onToggleSidebar,
  view,
  onChange,
  onQuickCapture
}: {
  sidebarVisibility: SidebarVisibility
  onToggleSidebar: () => void
  view: View
  onChange: (view: View) => void
  onQuickCapture: () => void
}): React.JSX.Element {
  return (
    <aside id="app-sidebar" className="sidebar">
      <div className="brand">
        <div className="brand-mark" aria-hidden="true"><Icon name="checklist" /></div>
        <div className="brand-text">
          <span className="brand-name">LifeAssistOS</span>
          <span className="brand-sub">Plan · learn · grow</span>
        </div>
        {sidebarVisibility === 'open' && (
          <button
            type="button"
            className="sidebar-toggle-button sidebar-collapse-button"
            aria-label="Collapse sidebar"
            aria-controls="app-sidebar"
            aria-expanded="true"
            title="Collapse sidebar"
            onClick={onToggleSidebar}
          >
            <span aria-hidden="true">‹</span>
          </button>
        )}
      </div>

      <button
        type="button"
        className="quick-capture-trigger ghost-button"
        onClick={onQuickCapture}
        aria-keyshortcuts="Control+Shift+K Meta+Shift+K"
        title="Save a thought to the Inbox"
      >
        <span aria-hidden="true"><Icon name="plus" /></span>
        <span>Quick capture</span>
        <kbd className="quick-capture-shortcut">Ctrl ⇧ K</kbd>
      </button>

      <nav className="nav" aria-label="Main navigation">
        {NAV_GROUPS.map((group) => (
          <div className="nav-group" key={group.label}>
            <span className="nav-group-label">{group.label}</span>
            {group.items.map((item) => (
              <button
                key={item}
                type="button"
                className={`nav-button ${view === item ? 'active' : ''}`}
                aria-current={view === item ? 'page' : undefined}
                onClick={() => onChange(item)}
              >
              <span className="nav-glyph"><Icon name={item === 'assistant' ? 'assistant' : item === 'tasks' ? 'tasks' : item === 'life' ? 'leaf' : item === 'projects' ? 'projects' : item === 'review' ? 'review' : 'settings'} /></span>
                <span>{VIEW_META[item].label}</span>
              </button>
            ))}
          </div>
        ))}
      </nav>

    </aside>
  )
}
