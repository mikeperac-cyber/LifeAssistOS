import { useCallback, useEffect, useMemo, useState } from 'react'
import type { InboxItem, PlanTask } from '../../../shared/types'
import { filterTasksByQuery, filterTasksForView, groupTasksForView, type TaskListView } from './todo-view-model'
import { TaskEditorDialog, type TaskEditorValues } from './TaskEditorDialog'
import { TodoTaskRow } from './TodoTaskRow'

type TodoFilter = TaskListView | 'inbox'
type TaskEditorState =
  | { kind: 'new'; parent?: PlanTask }
  | { kind: 'edit'; task: PlanTask }
  | { kind: 'convert'; item: InboxItem }

const FILTERS: Array<{ id: TodoFilter; label: string }> = [
  { id: 'today', label: 'Today' },
  { id: 'inbox', label: 'Inbox' },
  { id: 'upcoming', label: 'Upcoming' },
  { id: 'completed', label: 'Completed' },
  { id: 'archived', label: 'Archived' }
]

export function TodoView({ refreshVersion, onQuickCapture }: { refreshVersion: number; onQuickCapture: () => void }): React.JSX.Element {
  const [filter, setFilter] = useState<TodoFilter>('today')
  const [query, setQuery] = useState('')
  const [tasks, setTasks] = useState<PlanTask[]>([])
  const [inbox, setInbox] = useState<InboxItem[]>([])
  const [localDate, setLocalDate] = useState(getLocalDate)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [editor, setEditor] = useState<TaskEditorState | null>(null)

  const refresh = useCallback(async (): Promise<void> => {
    setLoading(true)
    setError('')
    try {
      const [allTasks, today] = await Promise.all([
        window.assist.getPlanTasks(true),
        window.assist.getToday()
      ])
      setTasks(allTasks)
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

  const visibleTasks = useMemo(() => {
    if (filter === 'inbox') return []
    return filterTasksByQuery(filterTasksForView(tasks, filter, localDate), query)
  }, [filter, localDate, query, tasks])
  const taskGroups = useMemo(() => groupTasksForView(visibleTasks, tasks), [tasks, visibleTasks])
  const visibleInbox = useMemo(() => inbox.filter((item) => matchesInboxQuery(item.text, query)), [inbox, query])
  const counts = useMemo(() => ({
    today: filterTasksForView(tasks, 'today', localDate).length,
    inbox: inbox.length,
    upcoming: filterTasksForView(tasks, 'upcoming', localDate).length,
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

  async function dismissInboxItem(item: InboxItem): Promise<void> {
    try {
      const result = await window.assist.dismissInbox(item.id)
      if (!result.ok) throw new Error(result.error ?? 'Could not dismiss this Inbox item.')
      await refresh()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    }
  }

  const activeLabel = FILTERS.find((item) => item.id === filter)?.label ?? 'Today'
  return (
    <section className="todo-view" aria-label="Tasks">
      <div className="todo-page-head">
        <div>
          <span className="eyebrow">Task workspace</span>
          <h2>{activeLabel}</h2>
          <p>{filter === 'today' ? 'Your overdue, due-today, and undated open tasks.' : filter === 'inbox' ? 'Captured thoughts, ready to sort into tasks.' : `Your ${activeLabel.toLocaleLowerCase()} tasks.`}</p>
        </div>
        <button className="primary-button" type="button" onClick={() => setEditor({ kind: 'new' })}>＋ New task</button>
      </div>

      <nav className="todo-filter-tabs" aria-label="Task lists">
        {FILTERS.map((item) => (
          <button key={item.id} type="button" className={`todo-filter-tab ${filter === item.id ? 'active' : ''}`} aria-current={filter === item.id ? 'page' : undefined} onClick={() => setFilter(item.id)}>
            <span>{item.label}</span><span className="todo-filter-count">{counts[item.id]}</span>
          </button>
        ))}
      </nav>

      <div className="todo-list-toolbar">
        <label className="todo-search">
          <span className="sr-only">Search tasks</span>
          <span aria-hidden="true">⌕</span>
          <input type="search" value={query} placeholder="Search titles and notes" onChange={(event) => setQuery(event.target.value)} />
          {query && <button type="button" aria-label="Clear search" onClick={() => setQuery('')}>×</button>}
        </label>
        {filter === 'inbox' && <button className="ghost-button" type="button" onClick={onQuickCapture}>＋ Capture thought</button>}
      </div>

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
          {taskGroups.map((group) => (
            <TodoTaskRow
              key={group.task.id}
              group={group}
              localDate={localDate}
              onToggleComplete={(task) => void updateStatus(task, task.status === 'done' ? 'open' : 'done')}
              onArchive={(task) => void updateStatus(task, task.status === 'cancelled' ? 'open' : 'cancelled')}
              onEdit={(task) => setEditor({ kind: 'edit', task })}
              onAddSubtask={(task) => setEditor({ kind: 'new', parent: task })}
            />
          ))}
        </div>
      ) : <EmptyState title={query ? 'No matching tasks' : `No ${activeLabel.toLocaleLowerCase()} tasks`} body={query ? 'Try another search or clear the filter.' : 'Add a task or capture a thought to get started.'} onCapture={onQuickCapture} />}

      {editor && (
        <TaskEditorDialog
          key={editor.kind === 'edit' ? `edit-${editor.task.id}` : editor.kind === 'convert' ? `convert-${editor.item.id}` : `new-${editor.parent?.id ?? 'root'}`}
          task={editor.kind === 'edit' ? editor.task : undefined}
          initialTitle={editor.kind === 'convert' ? editor.item.text : ''}
          heading={editor.kind === 'edit' ? 'Edit task' : editor.kind === 'convert' ? 'Turn Inbox item into a task' : editor.parent ? 'Add a subtask' : 'New task'}
          saveLabel={editor.kind === 'convert' ? 'Create task' : 'Save task'}
          onClose={() => setEditor(null)}
          onSave={saveEditor}
        />
      )}
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
