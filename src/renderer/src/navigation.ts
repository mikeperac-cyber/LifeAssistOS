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

export function shouldHandleQuickCaptureShortcut(
  event: Pick<KeyboardEvent, 'key' | 'ctrlKey' | 'metaKey' | 'altKey' | 'shiftKey' | 'defaultPrevented'>,
  focusIsProtected = false
): boolean {
  return !focusIsProtected && !event.defaultPrevented && !event.altKey && event.shiftKey &&
    (event.ctrlKey || event.metaKey) && event.key.toLocaleLowerCase() === 'k'
}
