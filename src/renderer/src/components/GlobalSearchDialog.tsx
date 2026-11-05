import { useEffect, useMemo, useRef, useState } from 'react'
import type {
  AssistantSkill,
  ChatMode,
  ChatSession,
  InboxItem,
  MemoryFact,
  PlanTask,
  ScheduledAgentTask,
  WorkflowRecord
} from '../../../shared/types'
import type { GlobalSearchSelection } from '../global-search'
import { globalSearchMatches, searchNavigationViews } from '../global-search'
import { VIEW_META } from '../navigation'

interface SearchOption {
  id: string
  group: string
  title: string
  detail: string
  selection: GlobalSearchSelection
}

interface GlobalSearchDialogProps {
  open: boolean
  workflows: WorkflowRecord[]
  scheduledTasks: ScheduledAgentTask[]
  skills: AssistantSkill[]
  onClose: () => void
  onSelect: (selection: GlobalSearchSelection) => void
}

export function GlobalSearchDialog({ open, workflows, scheduledTasks, skills, onClose, onSelect }: GlobalSearchDialogProps): React.JSX.Element {
  const dialogRef = useRef<HTMLDialogElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const optionRefs = useRef(new Map<string, HTMLButtonElement>())
  const [query, setQuery] = useState('')
  const [activeIndex, setActiveIndex] = useState(0)
  const [localResults, setLocalResults] = useState<SearchOption[]>([])
  const [searching, setSearching] = useState(false)
  const [partialError, setPartialError] = useState(false)

  useEffect(() => {
    const dialog = dialogRef.current
    if (!dialog) return
    if (open && !dialog.open) {
      dialog.showModal()
      requestAnimationFrame(() => inputRef.current?.focus())
    } else if (!open && dialog.open) {
      dialog.close()
    }
  }, [open])

  useEffect(() => {
    const cleanQuery = query.trim()
    setLocalResults([])
    setPartialError(false)
    if (cleanQuery.length < 2) {
      setSearching(false)
      return
    }

    let cancelled = false
    setSearching(true)
    const timeout = window.setTimeout(() => {
      void searchLocal(cleanQuery).then(({ results, partial }) => {
        if (cancelled) return
        setLocalResults(results)
        setPartialError(partial)
        setSearching(false)
      }).catch(() => {
        if (cancelled) return
        setPartialError(true)
        setSearching(false)
      })
    }, 120)
    return () => {
      cancelled = true
      window.clearTimeout(timeout)
    }
  }, [query])

  const staticOptions = useMemo(() => buildStaticOptions(query, workflows, scheduledTasks, skills), [query, workflows, scheduledTasks, skills])
  const options = useMemo(() => [...staticOptions, ...localResults], [staticOptions, localResults])

  useEffect(() => {
    setActiveIndex(0)
  }, [query, options.length])

  useEffect(() => {
    const activeOption = options[activeIndex]
    if (!activeOption) return
    optionRefs.current.get(activeOption.id)?.scrollIntoView({ block: 'nearest' })
  }, [activeIndex, options])

  const choose = (option: SearchOption): void => {
    onSelect(option.selection)
    onClose()
  }

  const moveActive = (direction: -1 | 1): void => {
    if (!options.length) return
    setActiveIndex((index) => (index + direction + options.length) % options.length)
  }

  return (
    <dialog
      ref={dialogRef}
      className="global-search-dialog"
      aria-labelledby="global-search-title"
      onCancel={(event) => { event.preventDefault(); onClose() }}
      onClick={(event) => { if (event.target === event.currentTarget) onClose() }}
    >
      <div className="global-search-panel">
        <div className="global-search-heading">
          <div>
            <span className="eyebrow">Local search</span>
            <h2 id="global-search-title">Search Mike Assist</h2>
          </div>
          <kbd className="global-search-escape">Esc</kbd>
        </div>
        <div className="global-search-input-wrap">
          <SearchIcon />
          <input
            ref={inputRef}
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.nativeEvent.isComposing) return
              if (event.key === 'ArrowDown') { event.preventDefault(); moveActive(1) }
              else if (event.key === 'ArrowUp') { event.preventDefault(); moveActive(-1) }
              else if (event.key === 'Home' && options.length) { event.preventDefault(); setActiveIndex(0) }
              else if (event.key === 'End' && options.length) { event.preventDefault(); setActiveIndex(options.length - 1) }
              else if (event.key === 'Enter' && options[activeIndex]) { event.preventDefault(); choose(options[activeIndex]!) }
              else if (event.key === 'Escape') { event.preventDefault(); onClose() }
            }}
            placeholder="Find a page, chat, task, note, or saved item…"
            role="combobox"
            aria-label="Search pages and local content"
            aria-autocomplete="list"
            aria-expanded="true"
            aria-controls="global-search-options"
            aria-activedescendant={options[activeIndex]?.id}
          />
          {searching && <span className="global-search-spinner" aria-label="Searching" />}
        </div>
        <div id="global-search-options" className="global-search-results" role="listbox" aria-label="Search results">
          {options.map((option, index) => (
            <button
              ref={(element) => {
                if (element) optionRefs.current.set(option.id, element)
                else optionRefs.current.delete(option.id)
              }}
              key={option.id}
              id={option.id}
              type="button"
              role="option"
              aria-selected={index === activeIndex}
              className={`global-search-option ${index === activeIndex ? 'active' : ''}`}
              onMouseEnter={() => setActiveIndex(index)}
              onClick={() => choose(option)}
            >
              <span className="global-search-option-copy">
                <strong>{option.title}</strong>
                {option.detail && <span>{option.detail}</span>}
              </span>
              <span className="global-search-group">{option.group}</span>
            </button>
          ))}
          {!searching && options.length === 0 && (
            <p className="global-search-empty">No matching pages or local items.</p>
          )}
        </div>
        <div className="global-search-footer" aria-live="polite">
          <span>{partialError ? 'Some local results could not be searched.' : searching ? 'Searching chats, notes, memory, and tasks on this device…' : 'Search stays on this device. Connected accounts are not queried.'}</span>
          <span><kbd>↑</kbd><kbd>↓</kbd> to move <kbd>Enter</kbd> to open</span>
        </div>
      </div>
    </dialog>
  )
}

async function searchLocal(query: string): Promise<{ results: SearchOption[]; partial: boolean }> {
  const requests: Array<Promise<unknown>> = [
    Promise.resolve().then(() => window.assist.searchChats(query, 'assistant')),
    Promise.resolve().then(() => window.assist.searchChats(query, 'coach_personal')),
    Promise.resolve().then(() => window.assist.searchChats(query, 'coach_business')),
    Promise.resolve().then(() => window.assist.searchVaultSummaries(query, 6)),
    Promise.resolve().then(() => window.assist.getPlanTasks(false)),
    Promise.resolve().then(() => window.assist.getToday()),
    Promise.resolve().then(() => window.assist.getMemory(query))
  ]
  const settled = await Promise.allSettled(requests)
  const partial = settled.some((result) => result.status === 'rejected')
  const assistantChats = settledValue<ChatSession[]>(settled[0]) ?? []
  const personalChats = settledValue<ChatSession[]>(settled[1]) ?? []
  const businessChats = settledValue<ChatSession[]>(settled[2]) ?? []
  const vault = settledValue<Awaited<ReturnType<typeof window.assist.searchVaultSummaries>>>(settled[3]) ?? []
  const tasks = settledValue<PlanTask[]>(settled[4]) ?? []
  const today = settledValue<Awaited<ReturnType<typeof window.assist.getToday>>>(settled[5])
  const memories = settledValue<MemoryFact[]>(settled[6]) ?? []

  const chatOptions = new Map<string, SearchOption>()
  const chatGroups: Array<[ChatMode, ChatSession[]]> = [
    ['assistant', assistantChats],
    ['coach_personal', personalChats],
    ['coach_business', businessChats]
  ]
  for (const [mode, sessions] of chatGroups) {
    for (const session of sessions) {
      if (!chatOptions.has(session.id)) {
        chatOptions.set(session.id, {
          id: `global-chat-${session.id}`,
          group: 'Chats',
          title: session.title,
          detail: chatModeLabel(mode),
          selection: { kind: 'chat', sessionId: session.id, mode }
        })
      }
    }
  }

  const results: SearchOption[] = [...chatOptions.values()].slice(0, 6)
  results.push(...vault.map((document) => ({
    id: `global-vault-${document.id}`,
    group: 'Knowledge Vault',
    title: document.title,
    detail: [document.tags.join(' · '), document.snippet].filter(Boolean).join(' — '),
    selection: { kind: 'vault', document } as const
  })))
  if (today) {
    results.push(...(today.inbox ?? [])
      .filter((item: InboxItem) => globalSearchMatches(query, item.text))
      .slice(0, 4)
      .map((item: InboxItem) => ({
        id: `global-inbox-${item.id}`,
        group: 'Today inbox',
        title: item.text,
        detail: 'Captured thought',
        selection: { kind: 'today-inbox', item } as const
      })))
  }
  results.push(...tasks
    .filter((task) => task.status === 'open' && globalSearchMatches(query, task.title, task.notes, task.dueDate ?? '', task.emailSource?.provider ?? '', task.calendarSource?.provider ?? ''))
    .slice(0, 5)
    .map((task) => ({
      id: `global-task-${task.id}`,
      group: 'Tasks',
      title: task.title,
      detail: task.dueDate ? `Due ${task.dueDate}` : `${task.priority} priority`,
      selection: { kind: 'today-task', task } as const
    })))
  results.push(...memories
    .filter((fact) => !fact.archivedAt && globalSearchMatches(query, fact.text, fact.scope))
    .slice(0, 5)
    .map((fact) => ({
      id: `global-memory-${fact.id}`,
      group: 'Memory',
      title: fact.text,
      detail: fact.scope,
      selection: { kind: 'memory', query, fact } as const
    })))
  return { results, partial }
}

function settledValue<T>(result: PromiseSettledResult<unknown> | undefined): T | null {
  return result?.status === 'fulfilled' ? result.value as T : null
}

function buildStaticOptions(
  query: string,
  workflows: WorkflowRecord[],
  scheduledTasks: ScheduledAgentTask[],
  skills: AssistantSkill[]
): SearchOption[] {
  const options: SearchOption[] = []
  if (globalSearchMatches(query, 'New chat', 'Assistant conversation create')) {
    options.push({ id: 'global-action-new-chat', group: 'Quick actions', title: 'New chat', detail: 'Start a fresh assistant conversation', selection: { kind: 'action', action: 'new-chat' } })
  }
  if (globalSearchMatches(query, 'Quick capture', 'Today inbox save a thought')) {
    options.push({ id: 'global-action-quick-capture', group: 'Quick actions', title: 'Quick capture', detail: 'Save a thought to the Today inbox', selection: { kind: 'action', action: 'quick-capture' } })
  }
  for (const view of searchNavigationViews(query)) {
    options.push({
      id: `global-view-${view}`,
      group: 'Pages',
      title: VIEW_META[view].label === 'Assistant' ? 'Chat' : VIEW_META[view].label,
      detail: VIEW_META[view].description,
      selection: { kind: 'view', view }
    })
  }
  if (query.trim().length >= 2) {
    for (const workflow of workflows.filter((item) => globalSearchMatches(query, item.name, item.prompt)).slice(0, 4)) {
      options.push({ id: `global-workflow-${workflow.id}`, group: 'Workflows', title: workflow.name, detail: workflow.prompt, selection: { kind: 'workflow', id: workflow.id } })
    }
    for (const task of scheduledTasks.filter((item) => globalSearchMatches(query, item.name, item.prompt)).slice(0, 4)) {
      options.push({ id: `global-schedule-${task.id}`, group: 'Scheduled', title: task.name, detail: task.enabled ? 'Enabled scheduled task' : 'Paused scheduled task', selection: { kind: 'scheduled', id: task.id } })
    }
    for (const skill of skills.filter((item) => globalSearchMatches(query, item.name, item.description, item.instructions)).slice(0, 4)) {
      options.push({ id: `global-skill-${skill.id}`, group: 'Skills', title: skill.name, detail: skill.description, selection: { kind: 'skill', id: skill.id } })
    }
  }
  return options
}

function chatModeLabel(mode: ChatMode): string {
  if (mode === 'coach_personal') return 'Personal coach'
  if (mode === 'coach_business') return 'Business coach'
  return mode === 'assistant' ? 'Assistant' : mode === 'review' ? 'Project review' : mode === 'software' ? 'Software' : 'Brainstorm'
}

function SearchIcon(): React.JSX.Element {
  return <svg viewBox="0 0 20 20" aria-hidden="true"><circle cx="8.5" cy="8.5" r="5.5" /><path d="m13 13 4 4" /></svg>
}
