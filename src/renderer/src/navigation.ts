export const VIEW_META = {
  chat: {
    label: 'Assistant',
    description: 'Local tools, gated by you · chat history stays on this device.'
  },
  today: {
    label: 'Today',
    description: 'Your next actions and capture inbox, stored locally.'
  },
  work: {
    label: 'Work',
    description: 'Plan tasks, open work context, and run the workflows you have approved.'
  },
  email: {
    label: 'Email',
    description: 'Search connected Gmail or Outlook and create local follow-up tasks with per-action approval.'
  },
  coach: {
    label: 'Coach',
    description: 'Personal life and Business / LB English coaching, private by default.'
  },
  scheduled: {
    label: 'Scheduled',
    description: 'Automatic check-ins and recurring agent tasks, with action approvals at run time.'
  },
  research: {
    label: 'Research',
    description: 'Collect allowlisted sources around one focused question.'
  },
  vault: {
    label: 'Knowledge Vault',
    description: 'Search durable notes and captured sources with local FTS5.'
  },
  cloud_files: {
    label: 'Cloud Files',
    description: 'Search and read connected Google Drive and OneDrive files with per-action approval.'
  },
  teaching: {
    label: 'LB English',
    description: 'IELTS Academic and English teaching packs for LB English.'
  },
  integrations: {
    label: 'Integrations',
    description: 'A transparent map of local data and connected capabilities.'
  },
  memory: {
    label: 'Memory',
    description: 'Facts you approved. Editable, deletable, and cited whenever recalled.'
  },
  activity: {
    label: 'Activity',
    description: 'Everything Mike Assist does, as an append-only record. No message contents are stored.'
  },
  finances: {
    label: 'Finances',
    description: 'Categorized income and expenditure from your local ledger.'
  },
  workflows: {
    label: 'Workflows',
    description: 'Save and replay approved local tool sequences.'
  },
  skills: {
    label: 'Skills',
    description: 'Reusable instructions that shape how the assistant works.'
  },
  settings: {
    label: 'Settings',
    description: 'Choose the model and the folders Mike Assist may touch.'
  }
} as const

export type View = keyof typeof VIEW_META

export const NAV_GROUPS: ReadonlyArray<{ label: string; items: readonly View[] }> = [
  { label: 'Workspace', items: ['chat', 'today', 'work', 'coach'] },
  { label: 'Communication', items: ['email'] },
  { label: 'Knowledge', items: ['memory', 'research', 'vault', 'cloud_files', 'teaching'] },
  { label: 'Tools', items: ['scheduled', 'workflows', 'skills', 'integrations', 'finances'] },
  { label: 'System', items: ['activity', 'settings'] }
]

export const SIDEBAR_SHORTCUT_STORAGE_KEY = 'mike-assist-sidebar-shortcuts'
export const DEFAULT_SIDEBAR_SHORTCUTS: View[] = ['today', 'work', 'workflows']
export const SIDEBAR_SHORTCUT_OPTIONS = Object.keys(VIEW_META) as View[]

export function normalizeSidebarShortcuts(value: unknown): View[] {
  if (!Array.isArray(value)) return [...DEFAULT_SIDEBAR_SHORTCUTS]
  return [...new Set(value.filter((item): item is View =>
    typeof item === 'string' && Object.prototype.hasOwnProperty.call(VIEW_META, item)
  ))].slice(0, 4)
}

export function filterNavigationGroups(query: string): Array<{ label: string; items: View[] }> {
  const normalizedQuery = query.trim().toLocaleLowerCase()
  const directMatches = new Set(NAV_GROUPS.flatMap((group) => group.items.filter((item) => {
    const label = VIEW_META[item].label === 'Assistant' ? 'Chat' : VIEW_META[item].label
    const aliases = item === 'today' ? ['Tasks'] : []
    return [label, VIEW_META[item].label, ...aliases].some((candidate) =>
      candidate.toLocaleLowerCase().includes(normalizedQuery)
    )
  })))

  return NAV_GROUPS.map((group) => ({
    label: group.label,
    items: group.items.filter((item) => !normalizedQuery || (
      directMatches.size > 0
        ? directMatches.has(item)
        : group.label.toLocaleLowerCase().includes(normalizedQuery)
    ))
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

export function resolveIntegrationTargetView(id: string): View {
  if (id === 'helper') return 'chat'
  if (id === 'finance' || id === 'finances') return 'finances'
  if (
    id === 'today' ||
    id === 'email' ||
    id === 'cloud_files' ||
    id === 'research' ||
    id === 'vault' ||
    id === 'teaching' ||
    id === 'memory' ||
    id === 'skills'
  ) {
    return id
  }
  return 'settings'
}
