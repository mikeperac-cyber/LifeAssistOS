import { useEffect, useMemo, useState } from 'react'
import type { PlanTask } from '../../../shared/types'
import type { TaskDraftSuggestion, TodoAiContext, TodoSubtaskSuggestion, TodayPlanSuggestion } from '../../../shared/todo-ai'
import type { TaskDraftValues } from './todo-ai-ui-model'
import { confirmTaskDraft, getTodoControlAvailability } from './todo-ai-ui-model'
import { filterTasksForView } from './todo-view-model'

interface EditableSubtask extends TodoSubtaskSuggestion {
  id: string
  selected: boolean
  saved: boolean
}

export function TodoAiActions({
  tasks,
  localDate,
  providerReady,
  onOpenSettings,
  onSaveTask,
  onSaveSubtask,
  onRefreshTasks
}: {
  tasks: PlanTask[]
  localDate: string
  providerReady: boolean
  onOpenSettings: () => void
  onSaveTask: (values: TaskDraftValues) => Promise<void>
  onSaveSubtask: (parentTaskId: string, values: TodoSubtaskSuggestion) => Promise<void>
  onRefreshTasks: () => Promise<void>
}): React.JSX.Element {
  const [draftText, setDraftText] = useState('')
  const [draft, setDraft] = useState<TaskDraftSuggestion | null>(null)
  const [draftReminder, setDraftReminder] = useState('')
  const [parentTaskId, setParentTaskId] = useState('')
  const [subtaskSuggestions, setSubtaskSuggestions] = useState<EditableSubtask[]>([])
  const [todayPlan, setTodayPlan] = useState<TodayPlanSuggestion | null>(null)
  const [pendingAi, setPendingAi] = useState<'draft' | 'subtasks' | 'plan' | null>(null)
  const [savingReview, setSavingReview] = useState<'draft' | 'subtasks' | null>(null)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  const openTasks = useMemo(() => tasks.filter((task) => task.status === 'open'), [tasks])
  const rootTasks = useMemo(() => openTasks.filter((task) => task.parentTaskId === null), [openTasks])
  const planTasks = useMemo(() => filterTasksForView(tasks, 'today', localDate), [localDate, tasks])
  const taskById = useMemo(() => new Map(tasks.map((task) => [task.id, task])), [tasks])
  const availability = getTodoControlAvailability(providerReady, pendingAi !== null)

  useEffect(() => {
    if (rootTasks.some((task) => task.id === parentTaskId)) return
    setParentTaskId(rootTasks[0]?.id ?? '')
    setSubtaskSuggestions([])
  }, [parentTaskId, rootTasks])

  useEffect(() => {
    setTodayPlan(null)
  }, [localDate, tasks])

  const context = (): TodoAiContext => ({
    localDate,
    timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
  })

  async function draftTask(): Promise<void> {
    if (!availability.canRunAi || !draftText.trim()) return
    setPendingAi('draft')
    setError('')
    setNotice('')
    try {
      const result = await window.assist.suggestTaskDraft(draftText.trim(), context())
      if (!result.ok) throw new Error(result.error)
      setDraft(result.suggestion)
      setDraftReminder(toLocalDateTime(result.suggestion.remindAt))
    } catch (cause) {
      setError(errorMessage(cause))
    } finally {
      setPendingAi(null)
    }
  }

  async function suggestSubtasksForParent(): Promise<void> {
    const parent = rootTasks.find((task) => task.id === parentTaskId)
    if (!availability.canRunAi || !parent) return
    setPendingAi('subtasks')
    setError('')
    setNotice('')
    setSubtaskSuggestions([])
    try {
      const result = await window.assist.suggestTaskSubtasks({
        title: parent.title,
        notes: parent.notes,
        dueDate: parent.dueDate,
        priority: parent.priority
      })
      if (!result.ok) throw new Error(result.error)
      setSubtaskSuggestions(result.suggestion.map((suggestion, index) => ({
        ...suggestion,
        id: `${Date.now()}-${index}`,
        selected: true,
        saved: false
      })))
      if (result.suggestion.length === 0) setNotice('No subtasks were suggested. Try adding more detail to the parent task.')
    } catch (cause) {
      setError(errorMessage(cause))
    } finally {
      setPendingAi(null)
    }
  }

  async function planToday(): Promise<void> {
    if (!availability.canRunAi || !planTasks.length || planTasks.length > 30) return
    setPendingAi('plan')
    setError('')
    setNotice('')
    try {
      const result = await window.assist.suggestTodayPlan(
        planTasks.map(({ id, title, dueDate, priority }) => ({ id, title, dueDate, priority })),
        context()
      )
      if (!result.ok) throw new Error(result.error)
      setTodayPlan(result.suggestion)
    } catch (cause) {
      setError(errorMessage(cause))
    } finally {
      setPendingAi(null)
    }
  }

  async function saveDraft(): Promise<void> {
    if (!draft || savingReview) return
    const reviewedDraft = { ...draft, title: draft.title.trim(), remindAt: fromLocalDateTime(draftReminder) }
    if (!reviewedDraft.title) {
      setError('Add a task title before saving the suggestion.')
      return
    }
    setSavingReview('draft')
    setError('')
    try {
      await confirmTaskDraft(reviewedDraft, onSaveTask)
      setDraft(null)
      setDraftText('')
      setNotice('Task added to your list.')
    } catch (cause) {
      setError(errorMessage(cause))
    } finally {
      setSavingReview(null)
    }
  }

  async function saveSelectedSubtasks(): Promise<void> {
    if (savingReview) return
    const parent = rootTasks.find((task) => task.id === parentTaskId)
    const selected = subtaskSuggestions.filter((suggestion) => suggestion.selected && !suggestion.saved)
    if (!parent || selected.length === 0) return
    if (selected.some((suggestion) => !suggestion.title.trim())) {
      setError('Give each selected subtask a title before adding it.')
      return
    }
    setSavingReview('subtasks')
    setError('')
    let added = 0
    try {
      for (const suggestion of selected) {
        await onSaveSubtask(parent.id, { title: suggestion.title.trim(), notes: suggestion.notes.trim() })
        added += 1
        setSubtaskSuggestions((current) => current.map((item) => item.id === suggestion.id
          ? { ...item, selected: false, saved: true }
          : item))
      }
      await onRefreshTasks()
      setNotice(`${added} subtask${added === 1 ? '' : 's'} added to ${parent.title}.`)
    } catch (cause) {
      await onRefreshTasks()
      setError(`${added > 0 ? `${added} subtask${added === 1 ? '' : 's'} saved. ` : ''}${errorMessage(cause)}`)
    } finally {
      setSavingReview(null)
    }
  }

  function updateDraft(patch: Partial<TaskDraftSuggestion>): void {
    setDraft((current) => current ? { ...current, ...patch } : current)
  }

  return (
    <section className="todo-ai-panel" aria-label="AI productivity tools" aria-busy={pendingAi !== null}>
      <details>
        <summary>
          <span className="todo-ai-heading"><span aria-hidden="true">✦</span> AI productivity</span>
          <span className="todo-ai-summary">Draft tasks, break down work, and plan today</span>
        </summary>
        <div className="todo-ai-content">
          <p className="todo-ai-privacy">AI sends your capture text or selected task titles, notes, due dates, and priorities to the configured provider. Suggestions stay drafts until you confirm them.</p>
          {!providerReady && (
            <div className="todo-ai-setup">
              <span>Choose a local model or configure a provider in Settings to use AI.</span>
              <button type="button" className="ghost-button" onClick={onOpenSettings}>Open Settings</button>
            </div>
          )}
          {error && <p className="todo-ai-message is-error" role="alert">{error}</p>}
          {notice && <p className="todo-ai-message" role="status">{notice}</p>}

          <div className="todo-ai-grid">
            <section className="todo-ai-card" aria-labelledby="todo-ai-draft-title">
              <div className="todo-ai-card-heading">
                <div><span className="todo-ai-step">01</span><h3 id="todo-ai-draft-title">Draft with AI</h3></div>
                <p>Turn a thought into a task.</p>
              </div>
              <label className="field field-wide">
                <span className="sr-only">Describe a task for AI</span>
                <textarea rows={2} maxLength={2000} value={draftText} placeholder="e.g. Send the project update Tuesday morning" onChange={(event) => setDraftText(event.target.value)} />
              </label>
              <button type="button" className="todo-ai-run" disabled={!availability.canRunAi || !draftText.trim()} onClick={() => void draftTask()}>
                {pendingAi === 'draft' ? 'Drafting…' : 'Draft a task'}
              </button>
              {draft && (
                <div className="todo-ai-review" aria-label="Review AI task draft">
                  <p className="todo-ai-review-label">Review and edit before adding</p>
                  <label className="field field-wide"><span className="field-label">Title</span><input value={draft.title} maxLength={240} onChange={(event) => updateDraft({ title: event.target.value })} /></label>
                  <label className="field field-wide"><span className="field-label">Notes</span><textarea rows={3} maxLength={2000} value={draft.notes} onChange={(event) => updateDraft({ notes: event.target.value })} /></label>
                  <div className="form-grid todo-ai-draft-fields">
                    <label className="field"><span className="field-label">Due date</span><input type="date" value={draft.dueDate ?? ''} onChange={(event) => updateDraft({ dueDate: event.target.value || null })} /></label>
                    <label className="field"><span className="field-label">Reminder</span><input type="datetime-local" value={draftReminder} onChange={(event) => setDraftReminder(event.target.value)} /></label>
                    <label className="field"><span className="field-label">Priority</span><select value={draft.priority} onChange={(event) => updateDraft({ priority: event.target.value as TaskDraftSuggestion['priority'] })}><option value="low">Low</option><option value="normal">Normal</option><option value="high">High</option></select></label>
                  </div>
                  <div className="todo-ai-review-actions">
                    <button type="button" className="ghost-button" disabled={savingReview !== null} onClick={() => setDraft(null)}>Discard</button>
                    <button type="button" className="todo-ai-run" disabled={savingReview !== null || !draft.title.trim()} onClick={() => void saveDraft()}>{savingReview === 'draft' ? 'Adding…' : 'Add task'}</button>
                  </div>
                </div>
              )}
            </section>

            <section className="todo-ai-card" aria-labelledby="todo-ai-breakdown-title">
              <div className="todo-ai-card-heading">
                <div><span className="todo-ai-step">02</span><h3 id="todo-ai-breakdown-title">Break into subtasks</h3></div>
                <p>Choose a parent task and review each step.</p>
              </div>
              <label className="field field-wide">
                <span className="field-label">Parent task</span>
                <select value={parentTaskId} disabled={!rootTasks.length} onChange={(event) => { setParentTaskId(event.target.value); setSubtaskSuggestions([]) }}>
                  {rootTasks.length === 0 ? <option value="">No open parent tasks</option> : rootTasks.map((task) => <option key={task.id} value={task.id}>{task.title}</option>)}
                </select>
              </label>
              <button type="button" className="todo-ai-run" disabled={!availability.canRunAi || !rootTasks.length} onClick={() => void suggestSubtasksForParent()}>
                {pendingAi === 'subtasks' ? 'Breaking it down…' : 'Suggest steps'}
              </button>
              {subtaskSuggestions.length > 0 && (
                <div className="todo-ai-review" aria-label="Review suggested subtasks">
                  <p className="todo-ai-review-label">Select and edit the steps to add</p>
                  <div className="todo-ai-subtask-list">
                    {subtaskSuggestions.map((suggestion) => (
                      <div className={`todo-ai-subtask ${suggestion.saved ? 'is-saved' : ''}`} key={suggestion.id}>
                        <label className="todo-ai-select-step"><input type="checkbox" checked={suggestion.selected} disabled={suggestion.saved || savingReview !== null} onChange={(event) => setSubtaskSuggestions((current) => current.map((item) => item.id === suggestion.id ? { ...item, selected: event.target.checked } : item))} /><span className="sr-only">Select {suggestion.title}</span></label>
                        <div className="todo-ai-step-fields">
                          <input aria-label="Subtask title" value={suggestion.title} maxLength={240} disabled={suggestion.saved || savingReview !== null} onChange={(event) => setSubtaskSuggestions((current) => current.map((item) => item.id === suggestion.id ? { ...item, title: event.target.value } : item))} />
                          <textarea aria-label="Subtask notes" rows={2} value={suggestion.notes} maxLength={2000} disabled={suggestion.saved || savingReview !== null} onChange={(event) => setSubtaskSuggestions((current) => current.map((item) => item.id === suggestion.id ? { ...item, notes: event.target.value } : item))} />
                        </div>
                        {suggestion.saved && <span className="todo-ai-saved">Added</span>}
                      </div>
                    ))}
                  </div>
                  <button type="button" className="todo-ai-run" disabled={savingReview !== null || !subtaskSuggestions.some((suggestion) => suggestion.selected && !suggestion.saved)} onClick={() => void saveSelectedSubtasks()}>
                    {savingReview === 'subtasks' ? 'Adding selected…' : 'Add selected steps'}
                  </button>
                </div>
              )}
            </section>

            <section className="todo-ai-card" aria-labelledby="todo-ai-plan-title">
              <div className="todo-ai-card-heading">
                <div><span className="todo-ai-step">03</span><h3 id="todo-ai-plan-title">Plan today</h3></div>
                <p>Get a suggested order for today’s tasks.</p>
              </div>
              {planTasks.length > 30 && <p className="todo-ai-limit">Daily planning supports up to 30 open tasks at a time.</p>}
              <button type="button" className="todo-ai-run" disabled={!availability.canRunAi || planTasks.length === 0 || planTasks.length > 30} onClick={() => void planToday()}>
                {pendingAi === 'plan' ? 'Planning…' : 'Suggest an order'}
              </button>
              {todayPlan && (
                <div className="todo-ai-review" aria-label="Review suggested daily plan">
                  <p className="todo-ai-review-label">Suggested order · your tasks remain unchanged</p>
                  {todayPlan.taskIds.length === 0 ? <p className="todo-ai-empty">No tasks were selected for today.</p> : (
                    <ol className="todo-ai-plan-list">
                      {todayPlan.taskIds.map((id) => {
                        const task = taskById.get(id)
                        return task ? <li key={id}><strong>{task.title}</strong><span>{todayPlan.rationaleByTaskId[id]}</span></li> : null
                      })}
                    </ol>
                  )}
                </div>
              )}
              {planTasks.length === 0 && <p className="todo-ai-empty">Add an open task due today (or leave it undated) to get a plan.</p>}
            </section>
          </div>
          {pendingAi && <p className="todo-ai-pending" role="status">Waiting for your AI provider…</p>}
        </div>
      </details>
    </section>
  )
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'AI task suggestions are unavailable. Check Settings and try again.'
}

function toLocalDateTime(value: string | null): string {
  if (!value) return ''
  const date = new Date(value)
  if (!Number.isFinite(date.getTime())) return ''
  const pad = (part: number): string => String(part).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`
}

function fromLocalDateTime(value: string): string | null {
  if (!value) return null
  const date = new Date(value)
  return Number.isFinite(date.getTime()) ? date.toISOString() : null
}
