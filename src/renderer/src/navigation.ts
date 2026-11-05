export const VIEW_META = {
  chat: {
    label: 'Assistant',
    description: 'Local tools, gated by you · chat history stays on this device.'
  },
  today: {
    label: 'Today',
    description: 'Your next actions and capture inbox, stored locally.'
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
  { label: 'Workspace', items: ['chat', 'today', 'coach'] },
  { label: 'Communication', items: ['email'] },
  { label: 'Knowledge', items: ['memory', 'research', 'vault', 'teaching'] },
  { label: 'Tools', items: ['scheduled', 'workflows', 'skills', 'integrations', 'finances'] },
  { label: 'System', items: ['activity', 'settings'] }
]

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
