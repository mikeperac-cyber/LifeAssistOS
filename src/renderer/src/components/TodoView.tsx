import { useCallback, useEffect, useMemo, useState } from 'react'
import type { CalendarEvent, InboxItem, PlanTask, TaskProject } from '../../../shared/types'
import type { PublicSettings } from '../../../shared/ipc'
import { filterTasksByQuery, filterTasksForView, groupTasksForView, type TaskListView } from './todo-view-model'
import { TaskEditorDialog, type TaskEditorValues } from './TaskEditorDialog'
import { TodoTaskRow } from './TodoTaskRow'
import { TodoAiActions } from './TodoAiActions'
import { AssistantPanel } from './AssistantPanel'
import { Icon } from './Icon'
import { AccessibleDialog } from './AccessibleDialog'
import { EMPTY_SAVED_TASK_FILTER, MAX_SAVED_TASK_VIEWS, SAVED_TASK_VIEWS_KEY, filterTasksForSavedView, readSavedTaskViews, type SavedTaskDateFilter, type SavedTaskFilters, type SavedTaskView } from './saved-task-views'
import type { TaskDraftValues } from './todo-ai-ui-model'
import { isProviderReady } from './provider-readiness'

type TodoFilter = TaskListView | 'inbox'
type TaskEditorState =
  | { kind: 'new'; parent?: PlanTask }
  | { kind: 'edit'; task: PlanTask }
  | { kind: 'convert'; item: InboxItem }

const FILTERS: Array<{ id: TodoFilter; label: string }> = [
  { id: 'my-day', label: 'My Day' },
  { id: 'today', label: 'Due & undated' },
  { id: 'inbox', label: 'Inbox' },
  { id: 'upcoming', label: 'Upcoming' },
  { id: 'overdue', label: 'Overdue' },
  { id: 'due-week', label: 'Due this week' },
  { id: 'waiting', label: 'Waiting' },
  { id: 'all', label: 'All tasks' },
  { id: 'completed', label: 'Completed' },
  { id: 'archived', label: 'Archived' }
]

export function TodoView({ refreshVersion, initialFilter = 'my-day', onQuickCapture, settings, onOpenSettings, onOpenLife }: {
  refreshVersion: number
  initialFilter?: TodoFilter
  onQuickCapture: () => void
  settings: PublicSettings | null
  onOpenSettings: () => void
  onOpenLife: () => void
}): React.JSX.Element {
  const [filter, setFilter] = useState<TodoFilter>(initialFilter)
  const [savedViews, setSavedViews] = useState<SavedTaskView[]>(readSavedTaskViews)
  const [activeSavedViewId, setActiveSavedViewId] = useState<string | null>(null)
  const [savedFilters, setSavedFilters] = useState<SavedTaskFilters>(EMPTY_SAVED_TASK_FILTER)
  const [filtersOpen, setFiltersOpen] = useState(false)
  const [saveViewOpen, setSaveViewOpen] = useState(false)
  const [saveViewName, setSaveViewName] = useState('')
  const [query, setQuery] = useState('')
  const [tasks, setTasks] = useState<PlanTask[]>([])
  const [projects, setProjects] = useState<TaskProject[]>([])
  const [inbox, setInbox] = useState<InboxItem[]>([])
  const [calendarEvents, setCalendarEvents] = useState<CalendarEvent[]>([])
  const [localDate, setLocalDate] = useState(getLocalDate)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [editor, setEditor] = useState<TaskEditorState | null>(null)
  const [lifeContextAvailable, setLifeContextAvailable] = useState({ goals: false, journal: false, personalContext: false })

  const refresh = useCallback(async (): Promise<void> => {
    setLoading(true)
    setError('')
    try {
      const [allTasks, today, projectWorkspace] = await Promise.all([
        window.assist.getPlanTasks(true),
        window.assist.getToday(),
        window.assist.getProjectWorkspace()
      ])
      setTasks(allTasks)
      setProjects(projectWorkspace.projects)
      setInbox(today.inbox)
      setLocalDate(today.date || getLocalDate())
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void refresh() }, [refresh, refreshVersion])

  useEffect(() => {
    let current = true
    void window.assist.getCalendarEvents(localDate, localDate).then((events) => { if (current) setCalendarEvents(events) }).catch(() => { if (current) setCalendarEvents([]) })
    return () => { current = false }
  }, [localDate, refreshVersion])

  useEffect(() => {
    void Promise.all([window.assist.getLifeWorkspace(), window.assist.getJournalEntries(), window.assist.getPersonalContext()])
      .then(([workspace, journal, profile]) => setLifeContextAvailable({
        goals: workspace.goals.some((goal) => goal.status !== 'done'),
        journal: journal.some((entry) => Boolean(entry.content.trim())),
        personalContext: Boolean(profile.aboutMe.trim() || profile.preferences.trim() || profile.currentFocus.trim())
      }))
      .catch(() => undefined)
  }, [])

  useEffect(() => {
    const unsubscribe = window.assist.onEvent((event) => {
      if (event.type === 'today_changed') void refresh()
    })
    const handleFocus = (): void => { void refresh() }
    window.addEventListener('focus', handleFocus)
    return () => {
      unsubscribe()
      window.removeEventListener('focus', handleFocus)
    }
  }, [refresh])

  useEffect(() => {
    try { window.localStorage.setItem(SAVED_TASK_VIEWS_KEY, JSON.stringify(savedViews)) }
    catch { /* Keep saved views available for this session if storage is unavailable. */ }
  }, [savedViews])

  const activeSavedView = savedViews.find((view) => view.id === activeSavedViewId) ?? null
  const customFiltersActive = savedFilters.projectId !== null || savedFilters.priority !== null || savedFilters.workflowStage !== null || savedFilters.dueDate !== 'any'
  const visibleTasks = useMemo(() => {
    if (filter === 'inbox') return []
    const criteria: SavedTaskView = { id: activeSavedViewId ?? 'active-view', name: activeSavedView?.name ?? '', baseView: filter, ...savedFilters }
    return filterTasksByQuery(filterTasksForSavedView(tasks, criteria, localDate), query)
  }, [activeSavedView?.name, activeSavedViewId, filter, localDate, query, savedFilters, tasks])
  const taskGroups = useMemo(() => groupTasksForView(visibleTasks, tasks), [tasks, visibleTasks])
  const visibleInbox = useMemo(() => inbox.filter((item) => matchesInboxQuery(item.text, query)), [inbox, query])
  const counts = useMemo(() => ({
    'my-day': filterTasksForView(tasks, 'my-day', localDate).length,
    today: filterTasksForView(tasks, 'today', localDate).length,
    inbox: inbox.length,
    upcoming: filterTasksForView(tasks, 'upcoming', localDate).length,
    overdue: filterTasksForView(tasks, 'overdue', localDate).length,
    'due-week': filterTasksForView(tasks, 'due-week', localDate).length,
    waiting: filterTasksForView(tasks, 'waiting', localDate).length,
    all: filterTasksForView(tasks, 'all', localDate).length,
    completed: filterTasksForView(tasks, 'completed', localDate).length,
    archived: filterTasksForView(tasks, 'archived', localDate).length
  }), [inbox.length, localDate, tasks])

  async function saveEditor(values: TaskEditorValues): Promise<void> {
    if (!editor) return
    let result
    if (editor.kind === 'new') {
      result = await window.assist.addPlanTask({ ...values, parentTaskId: editor.parent?.id ?? null })
    } else if (editor.kind === 'edit') {
      result = await window.assist.updatePlanTask(editor.task.id, values)
    } else {
      result = await window.assist.convertInbox(editor.item.id, values)
    }
    if (!result.ok) throw new Error(result.error ?? 'Could not save this task.')
    setEditor(null)
    await refresh()
  }

  async function updateStatus(task: PlanTask, status: PlanTask['status']): Promise<void> {
    try {
      const result = await window.assist.updatePlanTask(task.id, { status })
      if (!result.ok) throw new Error(result.error ?? 'Could not update this task.')
      await refresh()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    }
  }

  async function skipOccurrence(task: PlanTask): Promise<void> {
    try {
      const result = await window.assist.skipPlanTaskOccurrence(task.id)
      if (!result.ok) throw new Error(result.error ?? 'Could not skip this occurrence.')
      await refresh()
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)) }
  }

  async function planForToday(task: PlanTask): Promise<void> {
    try {
      const date = task.plannedDate === localDate ? null : localDate
      const result = await window.assist.planTaskForDay(task.id, date)
      if (!result.ok) throw new Error(result.error ?? 'Could not update My Day.')
      await refresh()
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)) }
  }

  async function clearTaskPlan(task: PlanTask): Promise<void> {
    try {
      const result = await window.assist.planTaskForDay(task.id, null)
      if (!result.ok) throw new Error(result.error ?? 'Could not clear the plan.')
      await refresh()
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)) }
  }

  async function moveMyDayGroup(groupIndex: number, direction: -1 | 1): Promise<void> {
    const groups = [...taskGroups]
    const target = groupIndex + direction
    if (target < 0 || target >= groups.length) return
    ;[groups[groupIndex], groups[target]] = [groups[target], groups[groupIndex]]
    const ids = groups.flatMap((group) => [group.task, ...group.subtasks].filter((task) => task.plannedDate === localDate).map((task) => task.id))
    try {
      const result = await window.assist.reorderMyDay(localDate, ids)
      if (!result.ok) throw new Error(result.error ?? 'Could not reorder My Day.')
      await refresh()
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)) }
  }

  async function applySuggestedPlan(ids: string[]): Promise<void> {
    const result = await window.assist.applySuggestedMyDayOrder(localDate, ids)
    if (!result.ok) throw new Error(result.error ?? 'Could not apply the suggested My Day order.')
    await refresh()
  }

  async function dismissInboxItem(item: InboxItem): Promise<void> {
    try {
      const result = await window.assist.dismissInbox(item.id)
      if (!result.ok) throw new Error(result.error ?? 'Could not dismiss this Inbox item.')
      await refresh()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    }
  }

  function activateSavedView(id: string): void {
    const next = savedViews.find((view) => view.id === id)
    if (!next) { setActiveSavedViewId(null); return }
    setFilter(next.baseView)
    setSavedFilters({ projectId: next.projectId, priority: next.priority, workflowStage: next.workflowStage, dueDate: next.dueDate })
    setActiveSavedViewId(next.id)
  }

  function updateSavedFilters(patch: Partial<SavedTaskFilters>): void {
    setActiveSavedViewId(null)
    setSavedFilters((current) => ({ ...current, ...patch }))
  }

  function saveCurrentView(event: React.FormEvent<HTMLFormElement>): void {
    event.preventDefault()
    const name = saveViewName.trim()
    if (!name || savedViews.length >= MAX_SAVED_TASK_VIEWS) return
    const view: SavedTaskView = {
      id: crypto.randomUUID(), name, baseView: filter === 'inbox' ? 'all' : filter,
      ...savedFilters
    }
    setSavedViews((current) => [...current, view])
    setActiveSavedViewId(view.id)
    setFilter(view.baseView)
    setSaveViewName('')
    setSaveViewOpen(false)
  }

  function deleteActiveSavedView(): void {
    if (!activeSavedView) return
    setSavedViews((current) => current.filter((view) => view.id !== activeSavedView.id))
    setActiveSavedViewId(null)
    setSavedFilters(EMPTY_SAVED_TASK_FILTER)
  }

  async function saveAiTask(values: TaskDraftValues): Promise<void> {
    const result = await window.assist.addPlanTask(values)
    if (!result.ok) throw new Error(result.error ?? 'Could not add this task.')
    await refresh()
  }

  async function saveAiSubtask(parentTaskId: string, values: { title: string; notes: string }): Promise<void> {
    const result = await window.assist.addPlanTask({ ...values, parentTaskId })
    if (!result.ok) throw new Error(result.error ?? 'Could not add this subtask.')
  }

  const activeLabel = activeSavedView?.name ?? FILTERS.find((item) => item.id === filter)?.label ?? 'My Day'
  const dueOutsidePlan = filter === 'my-day' && !customFiltersActive && !activeSavedView ? filterTasksByQuery(tasks.filter((task) => task.status === 'open' && task.dueDate !== null && task.dueDate <= localDate && task.plannedDate !== localDate), query) : []
  const dayTimeline = filter === 'my-day' ? [
    ...calendarEvents.map((event) => ({ key: `event-${event.id}`, time: event.startsAt, label: event.title, detail: event.location, kind: 'event' as const, allDay: event.allDay })),
    ...tasks.filter((task) => task.status === 'open' && task.scheduledStart?.slice(0, 10) === localDate).map((task) => ({ key: `task-${task.id}`, time: task.scheduledStart ?? '', label: task.title, detail: `${task.durationMinutes ?? 30} min planned`, kind: 'task' as const, allDay: false }))
  ].sort((a, b) => a.time.localeCompare(b.time)) : []
  return (
    <section className="todo-view" aria-label="Tasks">
      <div className="todo-page-head">
        <div>
          <h2>{activeLabel}</h2>
          <p>{activeSavedView ? 'Your saved task view. Adjust filters to explore a different slice of your work.' : filter === 'my-day' ? 'Choose what you intend to work on today. Due dates stay separate.' : filter === 'today' ? 'Overdue, due-today, and undated open tasks.' : filter === 'inbox' ? 'Captured thoughts, ready to sort into tasks.' : `Your ${activeLabel.toLocaleLowerCase()} tasks.`}</p>
        </div>
        <button className="primary-button todo-new-task" type="button" onClick={() => setEditor({ kind: 'new' })}><Icon name="plus" /> New task</button>
      </div>

      <div className="todo-layout">
        <div className="todo-workspace">
      <nav className="todo-filter-tabs" aria-label="Task lists">
        {FILTERS.map((item) => (
          <button key={item.id} type="button" className={`todo-filter-tab ${filter === item.id && !activeSavedView ? 'active' : ''}`} aria-current={filter === item.id && !activeSavedView ? 'page' : undefined} onClick={() => { setFilter(item.id); setActiveSavedViewId(null); setSavedFilters(EMPTY_SAVED_TASK_FILTER) }}>
            <span>{item.label}</span><span className="todo-filter-count">{counts[item.id]}</span>
          </button>
        ))}
      </nav>

      <div className="todo-list-toolbar">
        <label className="todo-search">
          <span className="sr-only">Search tasks</span>
          <span aria-hidden="true"><Icon name="search" /></span>
          <input type="search" value={query} placeholder="Search titles and notes" onChange={(event) => setQuery(event.target.value)} />
          {query && <button type="button" aria-label="Clear search" onClick={() => setQuery('')}>×</button>}
        </label>
        <div className="todo-view-actions">
          {savedViews.length > 0 && <label className="saved-view-select-label"><span className="sr-only">Saved task views</span><select aria-label="Saved task views" value={activeSavedViewId ?? ''} onChange={(event) => activateSavedView(event.target.value)}><option value="">Saved views</option>{savedViews.map((view) => <option key={view.id} value={view.id}>{view.name}</option>)}</select></label>}
          {filter !== 'inbox' && <>
            <button className={`ghost-button todo-filter-button${customFiltersActive ? ' active' : ''}`} type="button" aria-expanded={filtersOpen} onClick={() => setFiltersOpen((open) => !open)}><Icon name="filter" /> Filters{customFiltersActive ? ' · On' : ''}</button>
            <button className="ghost-button" type="button" disabled={savedViews.length >= MAX_SAVED_TASK_VIEWS} onClick={() => setSaveViewOpen(true)}>Save view</button>
            {activeSavedView && <button className="ghost-button saved-view-delete" type="button" onClick={deleteActiveSavedView} aria-label={`Delete saved view ${activeSavedView.name}`} title="Delete saved view">×</button>}
          </>}
          {filter === 'inbox' && <button className="ghost-button" type="button" onClick={onQuickCapture}>＋ Capture thought</button>}
        </div>
      </div>

      {filtersOpen && filter !== 'inbox' && <div className="saved-view-filters" aria-label="Task filters">
        <label><span>Project</span><select value={savedFilters.projectId ?? ''} onChange={(event) => updateSavedFilters({ projectId: event.target.value || null })}><option value="">Any project</option>{projects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}</select></label>
        <label><span>Priority</span><select value={savedFilters.priority ?? ''} onChange={(event) => updateSavedFilters({ priority: (event.target.value || null) as SavedTaskView['priority'] })}><option value="">Any priority</option><option value="high">High</option><option value="normal">Normal</option><option value="low">Low</option></select></label>
        <label><span>Stage</span><select value={savedFilters.workflowStage ?? ''} onChange={(event) => updateSavedFilters({ workflowStage: (event.target.value || null) as SavedTaskView['workflowStage'] })}><option value="">Any stage</option><option value="next">Next</option><option value="in-progress">In progress</option><option value="waiting">Waiting</option></select></label>
        <label><span>Due date</span><select value={savedFilters.dueDate} onChange={(event) => updateSavedFilters({ dueDate: event.target.value as SavedTaskDateFilter })}><option value="any">Any date</option><option value="today">Due today</option><option value="overdue">Overdue</option><option value="next-7-days">Next 7 days</option><option value="no-date">No due date</option></select></label>
        <button className="ghost-button" type="button" onClick={() => { setActiveSavedViewId(null); setSavedFilters(EMPTY_SAVED_TASK_FILTER) }}>Clear filters</button>
      </div>}

      <TodoAiActions
        tasks={tasks}
        localDate={localDate}
        providerReady={isProviderReady(settings)}
        onOpenSettings={onOpenSettings}
        onSaveTask={saveAiTask}
        onSaveSubtask={saveAiSubtask}
        onRefreshTasks={refresh}
        onApplyTodayPlan={applySuggestedPlan}
      />

      {filter === 'my-day' && <section className="today-agenda" aria-label="Today's schedule">
        <div className="today-agenda-heading"><div><span className="today-agenda-kicker"><Icon name="calendar" />Day context</span><h3>Your schedule</h3></div><button type="button" className="todo-row-action" onClick={onOpenLife}>Calendar settings</button></div>
        {dayTimeline.length ? <div className="today-agenda-list">{dayTimeline.map((item) => <div className={`today-agenda-item ${item.kind}`} key={item.key}><time>{item.allDay ? 'All day' : formatAgendaTime(item.time)}</time><span><strong>{item.label}</strong>{item.detail && <small>{item.detail}</small>}</span><em>{item.kind === 'event' ? 'Event' : 'Task'}</em></div>)}</div> : <p className="today-agenda-empty">No events or time blocks today. <button type="button" onClick={onOpenLife}>Import a calendar in Life</button></p>}
      </section>}

      {error && <div className="todo-error" role="alert"><span>{error}</span><button type="button" className="ghost-button" onClick={() => void refresh()}>Retry</button></div>}
      {loading ? <p className="todo-empty" role="status">Loading tasks…</p> : filter === 'inbox' ? (
        visibleInbox.length > 0 ? (
          <div className="todo-inbox-list" role="list" aria-label="Inbox items">
            {visibleInbox.map((item) => (
              <article className="todo-inbox-item" key={item.id} role="listitem">
                <div><span className="todo-task-context">Captured {formatCapturedDate(item.createdAt)}</span><p>{item.text}</p></div>
                <div className="todo-task-actions">
                  <button className="todo-row-action" type="button" onClick={() => setEditor({ kind: 'convert', item })}>Make task</button>
                  <button className="todo-row-action" type="button" onClick={() => void dismissInboxItem(item)}>Dismiss</button>
                </div>
              </article>
            ))}
          </div>
        ) : <EmptyState title={query ? 'No matching Inbox items' : 'Your Inbox is clear'} body={query ? 'Try another search.' : 'Capture a thought whenever something comes to mind.'} onCapture={onQuickCapture} />
      ) : taskGroups.length > 0 ? (
        <div className="todo-task-list" role="list" aria-label={`${activeLabel} tasks`}>
          {taskGroups.map((group, index) => (
            <TodoTaskRow
              key={group.task.id}
              group={group}
              localDate={localDate}
              onToggleComplete={(task) => void updateStatus(task, task.status === 'done' ? 'open' : 'done')}
              onArchive={(task) => void updateStatus(task, task.status === 'cancelled' ? 'open' : 'cancelled')}
              onEdit={(task) => setEditor({ kind: 'edit', task })}
              onAddSubtask={(task) => setEditor({ kind: 'new', parent: task })}
              onPlanForToday={(task) => void planForToday(task)}
              onClearPlan={(task) => void clearTaskPlan(task)}
              onSkipOccurrence={(task) => void skipOccurrence(task)}
              moveEarlier={filter === 'my-day' && !query && index > 0 ? () => void moveMyDayGroup(index, -1) : undefined}
              moveLater={filter === 'my-day' && !query && index < taskGroups.length - 1 ? () => void moveMyDayGroup(index, 1) : undefined}
            />
          ))}
        </div>
      ) : <EmptyState title={query ? 'No matching tasks' : `No ${activeLabel.toLocaleLowerCase()} tasks`} body={query ? 'Try another search or clear the filter.' : 'Add a task or capture a thought to get started.'} onCapture={onQuickCapture} />}
      {filter === 'my-day' && dueOutsidePlan.length > 0 && (
        <section className="my-day-due" aria-labelledby="my-day-due-heading">
          <div className="my-day-due-heading"><div><h3 id="my-day-due-heading">Due, outside your plan</h3><p>These deadlines stay visible even when you have not planned the tasks for today.</p></div><span>{dueOutsidePlan.length}</span></div>
          <div className="todo-task-list" role="list" aria-label="Tasks due today or overdue">
            {groupTasksForView(dueOutsidePlan, tasks).map((group) => <TodoTaskRow key={group.task.id} group={group} localDate={localDate} onToggleComplete={(task) => void updateStatus(task, task.status === 'done' ? 'open' : 'done')} onArchive={(task) => void updateStatus(task, task.status === 'cancelled' ? 'open' : 'cancelled')} onEdit={(task) => setEditor({ kind: 'edit', task })} onAddSubtask={(task) => setEditor({ kind: 'new', parent: task })} onPlanForToday={(task) => void planForToday(task)} onClearPlan={(task) => void clearTaskPlan(task)} onSkipOccurrence={(task) => void skipOccurrence(task)} />)}
          </div>
        </section>
      )}
        </div>
        <AssistantPanel providerReady={isProviderReady(settings)} lifeContextAvailable={lifeContextAvailable} onOpenSettings={onOpenSettings} />
      </div>

      {editor && (
        <TaskEditorDialog
          key={editor.kind === 'edit' ? `edit-${editor.task.id}` : editor.kind === 'convert' ? `convert-${editor.item.id}` : `new-${editor.parent?.id ?? 'root'}`}
          task={editor.kind === 'edit' ? editor.task : undefined}
          projects={projects}
          allowRecurrence={editor.kind === 'new' ? !editor.parent : editor.kind === 'edit' ? editor.task.parentTaskId === null : true}
          initialProjectId={editor.kind === 'new' && !editor.parent ? null : undefined}
          initialTitle={editor.kind === 'convert' ? editor.item.text : ''}
          heading={editor.kind === 'edit' ? 'Edit task' : editor.kind === 'convert' ? 'Turn Inbox item into a task' : editor.parent ? 'Add a subtask' : 'New task'}
          saveLabel={editor.kind === 'convert' ? 'Create task' : 'Save task'}
          onClose={() => setEditor(null)}
          onSave={saveEditor}
        />
      )}
      {saveViewOpen && <AccessibleDialog className="modal saved-view-dialog" labelledBy="saved-view-dialog-title" onCancel={() => setSaveViewOpen(false)}>
        <form onSubmit={saveCurrentView}>
          <h2 id="saved-view-dialog-title">Save this task view</h2>
          <p>Keep this combination of list, project, priority, stage, and deadline filters one click away.</p>
          <label><span>View name</span><input autoFocus maxLength={40} value={saveViewName} onChange={(event) => setSaveViewName(event.target.value)} placeholder="For example, Study this week" required /></label>
          <div className="saved-view-dialog-actions"><button className="ghost-button" type="button" onClick={() => setSaveViewOpen(false)}>Cancel</button><button className="primary-button" type="submit" disabled={!saveViewName.trim() || savedViews.length >= MAX_SAVED_TASK_VIEWS}>Save view</button></div>
        </form>
      </AccessibleDialog>}
    </section>
  )
}

function EmptyState({ title, body, onCapture }: { title: string; body: string; onCapture: () => void }): React.JSX.Element {
  return (
    <div className="todo-empty-state">
      <div className="todo-empty-mark" aria-hidden="true">✓</div>
      <h3>{title}</h3>
      <p>{body}</p>
      <button className="ghost-button" type="button" onClick={onCapture}>Quick capture</button>
    </div>
  )
}

function matchesInboxQuery(text: string, query: string): boolean {
  const terms = normalizeSearch(query).split(' ').filter(Boolean)
  if (!terms.length) return true
  const content = normalizeSearch(text)
  return terms.every((term) => content.includes(term))
}

function normalizeSearch(value: string): string {
  return value.normalize('NFKC').toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim()
}

function getLocalDate(): string {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
}

function formatCapturedDate(value: string): string {
  const date = new Date(value)
  return Number.isFinite(date.getTime()) ? date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : 'recently'
}

function formatAgendaTime(value: string): string {
  const date = new Date(value)
  return Number.isFinite(date.getTime()) ? date.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' }) : '—'
}
