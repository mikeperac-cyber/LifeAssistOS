import { NAV_GROUPS, VIEW_META, type View } from './navigation'
import type { ChatMode, InboxItem, MemoryFact, PlanTask, VaultQuickSearchResult } from '../../shared/types'

const VIEW_KEYWORDS: Record<View, string> = {
  chat: 'assistant conversation conversations ask write create new',
  today: 'task tasks inbox capture reminder reminders plan',
  work: 'work workspace tasks email files research teaching workflows schedule',
  email: 'mail messages gmail outlook communication follow up followup correspondence',
  cloud_files: 'cloud file files google drive onedrive microsoft storage search read pdf docx xlsx documents',
  coach: 'goal goals habits reflection personal business',
  scheduled: 'schedule schedules recurring automatic reminder',
  research: 'sources papers links web citations',
  vault: 'knowledge notes documents ideas files',
  teaching: 'english lessons ielts education',
  integrations: 'connections accounts google microsoft gmail outlook drive calendar tasks',
  memory: 'facts recall remember personal business',
  activity: 'audit log history events',
  finances: 'finance money budget expenses income ledger',
  workflows: 'workflow automation sequence repeat',
  skills: 'skill instructions reusable',
  settings: 'preferences configuration provider theme appearance'
}

export type GlobalSearchSelection =
  | { kind: 'view'; view: View }
  | { kind: 'action'; action: 'new-chat' | 'quick-capture' }
  | { kind: 'chat'; sessionId: string; mode: ChatMode }
  | { kind: 'vault'; document: VaultQuickSearchResult }
  | { kind: 'today-task'; task: PlanTask }
  | { kind: 'today-inbox'; item: InboxItem }
  | { kind: 'memory'; query: string; fact: MemoryFact }
  | { kind: 'workflow'; id: string }
  | { kind: 'scheduled'; id: string }
  | { kind: 'skill'; id: string }

export type TodaySearchTarget = Extract<GlobalSearchSelection, { kind: 'today-task' | 'today-inbox' }>

export type GlobalSearchKeyAction = 'next' | 'previous' | 'select' | 'close' | null

export function globalSearchKeyAction(key: string): GlobalSearchKeyAction {
  switch (key) {
    case 'ArrowDown': return 'next'
    case 'ArrowUp': return 'previous'
    case 'Enter': return 'select'
    case 'Escape': return 'close'
    default: return null
  }
}

export function normalizeGlobalSearchText(value: string): string {
  return value.normalize('NFKD').toLocaleLowerCase().replace(/\p{M}/gu, '').replace(/[^\p{L}\p{N}]+/gu, ' ').trim()
}

export function globalSearchMatches(query: string, ...fields: string[]): boolean {
  const terms = normalizeGlobalSearchText(query).split(/\s+/).filter(Boolean)
  if (terms.length === 0) return true
  const corpus = normalizeGlobalSearchText(fields.join(' '))
  return terms.every((term) => corpus.includes(term))
}

export function searchNavigationViews(query: string): View[] {
  return NAV_GROUPS.flatMap((group) => group.items.filter((view) =>
    globalSearchMatches(query, VIEW_META[view].label, VIEW_META[view].description, group.label, VIEW_KEYWORDS[view])
  ))
}
