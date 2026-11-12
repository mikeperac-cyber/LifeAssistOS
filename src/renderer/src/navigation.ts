export const VIEW_META = {
  tasks: {
    label: 'Tasks',
    description: 'Capture, organize, and finish your work.'
  },
  assistant: {
    label: 'Assistant',
    description: 'Coach through a decision, learn something, or get everyday help.'
  },
  review: {
    label: 'Review',
    description: 'See what needs attention and choose a clear next step.'
  },
  projects: {
    label: 'Projects',
    description: 'Organize work by Area, project, and next step.'
  },
  life: {
    label: 'Dashboard',
    description: 'Connect goals, routines, notes, and your calendar.'
  },
  settings: {
    label: 'Settings',
    description: 'Manage your AI provider, appearance, and local backups.'
  }
} as const

export type View = keyof typeof VIEW_META
export const DEFAULT_VIEW: View = 'life'

/** Preserve saved routes and send unrecognized routes to Tasks. */
export function normalizeView(value: unknown): View {
  return value === 'settings' || value === 'projects' || value === 'review' || value === 'assistant' || value === 'life' ? value : 'tasks'
}

export const NAV_GROUPS: ReadonlyArray<{ label: string; items: readonly View[] }> = [
  { label: 'Main', items: ['life', 'tasks', 'assistant', 'review', 'projects'] },
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
