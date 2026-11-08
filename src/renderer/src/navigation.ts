export const VIEW_META = {
  tasks: {
    label: 'Tasks',
    description: 'Capture, organize, and finish your work.'
  },
  settings: {
    label: 'Settings',
    description: 'Manage your AI provider, appearance, and local backups.'
  }
} as const

export type View = keyof typeof VIEW_META
export const DEFAULT_VIEW: View = 'tasks'

/** Redirect routes saved by older Mike Assist versions to the new Tasks home. */
export function normalizeView(value: unknown): View {
  return value === 'settings' ? 'settings' : 'tasks'
}

export const NAV_GROUPS: ReadonlyArray<{ label: string; items: readonly View[] }> = [
  { label: 'Main', items: ['tasks'] },
  { label: 'System', items: ['settings'] }
]

export const SIDEBAR_SHORTCUT_STORAGE_KEY = 'mike-assist-sidebar-shortcuts'
export const DEFAULT_SIDEBAR_SHORTCUTS: View[] = ['tasks']
export const SIDEBAR_SHORTCUT_OPTIONS = Object.keys(VIEW_META) as View[]
export type SidebarVisibility = 'open' | 'closed'
export const SIDEBAR_VISIBILITY_STORAGE_KEY = 'mike-assist-sidebar-open'

export function normalizeSidebarVisibility(value: unknown): SidebarVisibility {
  return value === 'closed' ? 'closed' : 'open'
}

export function readSidebarVisibility(readStorageValue: (key: string) => string | null): SidebarVisibility {
  try {
    return normalizeSidebarVisibility(readStorageValue(SIDEBAR_VISIBILITY_STORAGE_KEY))
  } catch {
    return 'open'
  }
}

export function normalizeSidebarShortcuts(value: unknown): View[] {
  if (!Array.isArray(value)) return [...DEFAULT_SIDEBAR_SHORTCUTS]
  const migrated = value.map((item) => item === 'today' ? 'tasks' : item)
  return [...new Set(migrated.filter((item): item is View =>
    typeof item === 'string' && Object.prototype.hasOwnProperty.call(VIEW_META, item)
  ))].slice(0, 4)
}

export function filterNavigationGroups(query: string): Array<{ label: string; items: View[] }> {
  const normalizedQuery = query.trim().toLocaleLowerCase()
  return NAV_GROUPS.map((group) => ({
    label: group.label,
    items: group.items.filter((item) => !normalizedQuery ||
      VIEW_META[item].label.toLocaleLowerCase().includes(normalizedQuery))
  })).filter((group) => group.items.length > 0)
}

export function shouldHandleNavigationShortcut(
  event: Pick<KeyboardEvent, 'key' | 'ctrlKey' | 'metaKey' | 'altKey' | 'shiftKey' | 'defaultPrevented'>,
  focusIsProtected = false
): boolean {
  return !focusIsProtected && !event.defaultPrevented && !event.altKey && !event.shiftKey &&
    (event.ctrlKey || event.metaKey) && event.key.toLocaleLowerCase() === 'k'
}

export function shouldHandleQuickCaptureShortcut(
  event: Pick<KeyboardEvent, 'key' | 'ctrlKey' | 'metaKey' | 'altKey' | 'shiftKey' | 'defaultPrevented'>,
  focusIsProtected = false
): boolean {
  return !focusIsProtected && !event.defaultPrevented && !event.altKey && event.shiftKey &&
    (event.ctrlKey || event.metaKey) && event.key.toLocaleLowerCase() === 'k'
}
