import { useEffect, useRef, useState } from 'react'
import type { GoogleTask, GoogleTaskList, PlanTask, TodaySnapshot } from '../../../shared/types'
import type { PublicGoogleTasksSettings } from '../../../shared/ipc'

export function TodayView({ googleTasksSettings, disabled, onOpenSettings, onSettingsRefresh }: {
  googleTasksSettings: PublicGoogleTasksSettings | null
  disabled: boolean
  onOpenSettings: () => void
  onSettingsRefresh: (settings: PublicGoogleTasksSettings) => void
}): React.JSX.Element {
  const [snapshot, setSnapshot] = useState<TodaySnapshot>({ date: '', tasks: [], inbox: [] })
  const [capture, setCapture] = useState('')
  const [task, setTask] = useState('')
  const [dueDate, setDueDate] = useState('')
  const [reminderDraft, setReminderDraft] = useState('')
  const [editingReminderId, setEditingReminderId] = useState<string | null>(null)
  const [priority, setPriority] = useState<'low' | 'normal' | 'high'>('normal')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const [loadFailed, setLoadFailed] = useState(false)
  const [googleTaskLists, setGoogleTaskLists] = useState<GoogleTaskList[]>([])
  const [googleTaskListsLoaded, setGoogleTaskListsLoaded] = useState(false)
  const [googleTaskListsPageToken, setGoogleTaskListsPageToken] = useState<string | undefined>()
  const [selectedGoogleTaskListId, setSelectedGoogleTaskListId] = useState('')
  const [googleTasks, setGoogleTasks] = useState<GoogleTask[]>([])
  const [googleTasksLoaded, setGoogleTasksLoaded] = useState(false)
  const [googleTasksPageToken, setGoogleTasksPageToken] = useState<string | undefined>()
  const [googleTasksReadBusy, setGoogleTasksReadBusy] = useState(false)
  const [googleTasksError, setGoogleTasksError] = useState('')
  const googleTasksReadBusyRef = useRef(false)

  const load = async (): Promise<void> => {
    setLoading(true)
    setError('')
    try {
      setSnapshot(await window.assist.getToday())
      setLoadFailed(false)
    } catch (cause) {
      setLoadFailed(true)
      setError(errorText(cause, 'Could not load Today.'))
    } finally {
      setLoading(false)
    }
  }
  useEffect(() => { void load() }, [])

  const addCapture = async (): Promise<void> => {
    try {
      const result = await window.assist.captureInbox(capture)
      if (result.snapshot) { setSnapshot(result.snapshot); setCapture(''); setError('') }
      else setError(result.error ?? 'Could not capture that.')
    } catch (cause) {
      setError(errorText(cause, 'Could not capture that.'))
    }
  }

  const addTask = async (): Promise<void> => {
    try {
      const result = await window.assist.addPlanTask({
        title: task,
        dueDate: dueDate || null,
        remindAt: localDateTimeToIso(reminderDraft),
        priority
      })
      if (result.snapshot) {
        setSnapshot(result.snapshot)
        setTask('')
        setDueDate('')
        setReminderDraft('')
        setError('')
      } else setError(result.error ?? 'Could not add that task.')
    } catch (cause) {
      setError(errorText(cause, 'Could not add that task.'))
    }
  }

  const complete = async (id: string): Promise<void> => {
    try {
      const result = await window.assist.updatePlanTask(id, { status: 'done' })
      if (result.snapshot) { setSnapshot(result.snapshot); setError('') }
      else setError(result.error ?? 'Could not complete that task.')
    } catch (cause) {
      setError(errorText(cause, 'Could not complete that task.'))
    }
  }

  const saveReminder = async (item: PlanTask, value = reminderDraft): Promise<void> => {
    try {
      const result = await window.assist.updatePlanTask(item.id, { remindAt: localDateTimeToIso(value) })
      if (result.snapshot) {
        setSnapshot(result.snapshot)
        setEditingReminderId(null)
        setReminderDraft('')
        setError('')
      } else setError(result.error ?? 'Could not update that reminder.')
    } catch (cause) {
      setError(errorText(cause, 'Could not update that reminder.'))
    }
  }

  const clearReminder = async (item: PlanTask): Promise<void> => {
    try {
      const result = await window.assist.updatePlanTask(item.id, { remindAt: null })
      if (result.snapshot) {
        setSnapshot(result.snapshot)
        setEditingReminderId(null)
        setReminderDraft('')
        setError('')
      } else setError(result.error ?? 'Could not clear that reminder.')
    } catch (cause) {
      setError(errorText(cause, 'Could not clear that reminder.'))
    }
  }

  const convert = async (id: string): Promise<void> => {
    try {
      const result = await window.assist.convertInbox(id)
      if (result.snapshot) { setSnapshot(result.snapshot); setError('') }
      else setError(result.error ?? 'Could not convert that inbox item.')
    } catch (cause) {
      setError(errorText(cause, 'Could not convert that inbox item.'))
    }
  }

  const dismiss = async (id: string): Promise<void> => {
    try {
      const result = await window.assist.dismissInbox(id)
      if (result.snapshot) { setSnapshot(result.snapshot); setError('') }
      else setError(result.error ?? 'Could not dismiss that inbox item.')
    } catch (cause) {
      setError(errorText(cause, 'Could not dismiss that inbox item.'))
    }
  }

  const loadGoogleTaskLists = async (pageToken?: string): Promise<void> => {
    if (googleTasksReadBusyRef.current) return
    googleTasksReadBusyRef.current = true
    setGoogleTasksReadBusy(true)
    setGoogleTasksError('')
    try {
      const result = await window.assist.listGoogleTaskLists(pageToken)
      if (result.settings) onSettingsRefresh(result.settings)
      if (!result.ok || !result.lists) throw new Error(result.error ?? 'Could not load Google Tasks lists.')
      setGoogleTaskLists((current) => pageToken ? [...current, ...result.lists!] : result.lists!)
      setGoogleTaskListsLoaded(true)
      setGoogleTaskListsPageToken(result.nextPageToken)
      if (!pageToken) {
        setSelectedGoogleTaskListId((current) =>
          current && result.lists!.some((list) => list.id === current) ? current : result.lists![0]?.id ?? ''
        )
        setGoogleTasks([])
        setGoogleTasksLoaded(false)
        setGoogleTasksPageToken(undefined)
      }
    } catch (cause) {
      setGoogleTasksError(errorText(cause, 'Could not load Google Tasks lists.'))
    } finally {
      googleTasksReadBusyRef.current = false
      setGoogleTasksReadBusy(false)
    }
  }

  const loadGoogleTasks = async (pageToken?: string): Promise<void> => {
    if (!selectedGoogleTaskListId || googleTasksReadBusyRef.current) return
    googleTasksReadBusyRef.current = true
    setGoogleTasksReadBusy(true)
    setGoogleTasksError('')
    try {
      const result = await window.assist.listGoogleTasks(selectedGoogleTaskListId, pageToken)
      if (result.settings) onSettingsRefresh(result.settings)
      if (!result.ok || !result.tasks) throw new Error(result.error ?? 'Could not load Google Tasks.')
      setGoogleTasks((current) => pageToken ? [...current, ...result.tasks!] : result.tasks!)
      setGoogleTasksLoaded(true)
      setGoogleTasksPageToken(result.nextPageToken)
    } catch (cause) {
      setGoogleTasksError(errorText(cause, 'Could not load Google Tasks.'))
    } finally {
      googleTasksReadBusyRef.current = false
      setGoogleTasksReadBusy(false)
    }
  }

  return (
    <div className="today-view">
      <div className="today-header">
        <div>
          <span className="eyebrow">Command center</span>
          <h2>Today</h2>
          <p>Keep the next useful action visible without turning your day into a rigid schedule.</p>
          <p className="reminder-help">Set an optional Windows notification. It appears while Mike Assist is running; overdue reminders appear once the next time it opens.</p>
        </div>
        <span className="today-date">{loading ? 'Loading…' : snapshot.date}</span>
      </div>

      {loading ? (
        <p className="muted today-load-status" role="status">Loading today’s tasks and inbox…</p>
      ) : loadFailed ? (
        <div className="today-error-state">
          <p role="alert">{error}</p>
          <button className="ghost-button" type="button" onClick={() => void load()}>Retry</button>
        </div>
      ) : <>
      <div className="today-grid">
        <section className="today-card today-tasks">
          <div className="today-card-head"><h3>Next actions</h3><span>{snapshot.tasks.length}</span></div>
          <div className="task-add">
            <input value={task} onChange={(event) => setTask(event.target.value)} placeholder="Add a task…" aria-label="Task title" onKeyDown={(event) => { if (event.key === 'Enter') void addTask() }} />
            <input type="date" value={dueDate} onChange={(event) => setDueDate(event.target.value)} aria-label="Task due date" />
            <input type="datetime-local" value={reminderDraft} onChange={(event) => setReminderDraft(event.target.value)} aria-label="Optional reminder date and time" />
            <select value={priority} onChange={(event) => setPriority(event.target.value as typeof priority)} aria-label="Task priority">
              <option value="normal">Normal</option><option value="high">High</option><option value="low">Low</option>
            </select>
            <button className="primary-button" type="button" disabled={!task.trim()} onClick={() => void addTask()}>Add</button>
          </div>
          <div className="today-task-list">
            {snapshot.tasks.map((item) => (
              <div className={`today-task priority-${item.priority}`} key={item.id}>
                <button type="button" className="task-check" onClick={() => void complete(item.id)} aria-label={`Complete ${item.title}`}>○</button>
                <div className="today-task-copy">
                  <strong>{item.title}</strong>
                  {item.dueDate && <span>Due {item.dueDate}</span>}
                  {item.remindAt && editingReminderId !== item.id && <span>Reminder {formatReminder(item.remindAt)}</span>}
                </div>
                {editingReminderId === item.id ? (
                  <div className="task-reminder-editor">
                    <input type="datetime-local" value={reminderDraft} onChange={(event) => setReminderDraft(event.target.value)} aria-label={`Reminder time for ${item.title}`} />
                    <button className="ghost-button" type="button" onClick={() => void saveReminder(item)}>Save</button>
                    {item.remindAt && <button className="ghost-button" type="button" onClick={() => void clearReminder(item)}>Clear</button>}
                    <button className="ghost-button" type="button" onClick={() => { setEditingReminderId(null); setReminderDraft('') }}>Cancel</button>
                  </div>
                ) : (
                  <button className="ghost-button task-reminder-button" type="button" onClick={() => {
                    setReminderDraft(toLocalDateTime(item.remindAt))
                    setEditingReminderId(item.id)
                    setError('')
                  }}>{item.remindAt ? 'Edit reminder' : 'Remind me'}</button>
                )}
              </div>
            ))}
            {snapshot.tasks.length === 0 && <p className="muted">No open tasks due today. Add one when it becomes real.</p>}
          </div>
        </section>

        <section className="today-card today-inbox">
          <div className="today-card-head"><h3>Inbox</h3><span>{snapshot.inbox.length}</span></div>
          <div className="inbox-add">
            <input value={capture} onChange={(event) => setCapture(event.target.value)} placeholder="Capture a thought…" aria-label="Inbox capture" onKeyDown={(event) => { if (event.key === 'Enter') void addCapture() }} />
            <button className="ghost-button" type="button" disabled={!capture.trim()} onClick={() => void addCapture()}>Capture</button>
          </div>
          <div className="inbox-list">
            {snapshot.inbox.map((item) => (
              <div className="inbox-item" key={item.id}>
                <p>{item.text}</p>
                <div><button className="ghost-button" type="button" onClick={() => void convert(item.id)}>Make task</button><button className="danger-button" type="button" onClick={() => void dismiss(item.id)}>Dismiss</button></div>
              </div>
            ))}
            {snapshot.inbox.length === 0 && <p className="muted">The inbox is clear.</p>}
          </div>
        </section>
      </div>
      <section className="today-card today-google-tasks" aria-labelledby="google-tasks-title">
        <div className="today-card-head">
          <h3 id="google-tasks-title">Google Tasks</h3>
          {googleTasksSettings?.connected && googleTasks.length > 0 && <span>{googleTasks.length} open</span>}
        </div>
        <p className="today-google-tasks-note">Read-only connection. Loading lists and tasks asks for approval each time. Chat may send approved results to your configured model provider.</p>
        {googleTasksSettings === null ? (
          <p className="muted" role="status">Checking Google Tasks connection…</p>
        ) : !googleTasksSettings.connected ? (
          <div className="today-google-tasks-empty">
            <p>Connect Google Tasks to view a list alongside your local tasks.</p>
            <button className="ghost-button" type="button" onClick={onOpenSettings} disabled={disabled}>Open Settings</button>
          </div>
        ) : (
          <>
            <div className="today-google-tasks-controls">
              <button className="ghost-button" type="button" onClick={() => void loadGoogleTaskLists()} disabled={disabled || googleTasksReadBusy}>
                {googleTasksReadBusy ? 'Waiting…' : googleTaskListsLoaded ? 'Refresh lists' : 'Load task lists'}
              </button>
              {googleTaskLists.length > 0 && (
                <>
                  <label className="today-google-task-list-select">
                    <span className="sr-only">Google Tasks list</span>
                    <select
                      value={selectedGoogleTaskListId}
                      disabled={disabled || googleTasksReadBusy}
                      onChange={(event) => {
                        setSelectedGoogleTaskListId(event.target.value)
                        setGoogleTasks([])
                        setGoogleTasksLoaded(false)
                        setGoogleTasksPageToken(undefined)
                        setGoogleTasksError('')
                      }}
                    >
                      {googleTaskLists.map((list) => <option key={list.id} value={list.id}>{list.title}</option>)}
                    </select>
                  </label>
                  <button className="ghost-button" type="button" onClick={() => void loadGoogleTasks()} disabled={disabled || googleTasksReadBusy || !selectedGoogleTaskListId}>
                    {googleTasksReadBusy ? 'Waiting…' : 'Load open tasks'}
                  </button>
                </>
              )}
              {googleTaskListsPageToken && (
                <button className="ghost-button" type="button" onClick={() => void loadGoogleTaskLists(googleTaskListsPageToken)} disabled={disabled || googleTasksReadBusy}>Load more lists</button>
              )}
            </div>
            {googleTaskListsLoaded && googleTaskLists.length === 0 && <p className="muted">No Google Tasks lists were found.</p>}
            {googleTasks.length > 0 ? (
              <div className="today-google-task-list">
                {googleTasks.map((item) => (
                  <article className="today-google-task" key={`${selectedGoogleTaskListId}:${item.id}`}>
                    <div className="today-google-task-copy">
                      <strong>{item.title}</strong>
                      {item.due && <span>Due {formatTaskDue(item.due)}</span>}
                      {item.notes && <p>{item.notes}{item.notesTruncated && <span> Note shortened to 4,000 characters.</span>}</p>}
                    </div>
                    <span className="today-google-task-status">{item.status === 'completed' ? 'Completed' : 'Open'}</span>
                  </article>
                ))}
                {googleTasksPageToken && (
                  <button className="ghost-button" type="button" onClick={() => void loadGoogleTasks(googleTasksPageToken)} disabled={disabled || googleTasksReadBusy}>Load more tasks</button>
                )}
              </div>
            ) : googleTasksLoaded ? (
              <p className="muted">There are no open tasks in this Google Tasks list.</p>
            ) : googleTaskListsLoaded && googleTaskLists.length > 0 ? (
              <p className="muted">Choose a list, then load its open tasks.</p>
            ) : null}
            {googleTasksError && <p className="status-error" role="alert">{googleTasksError}</p>}
          </>
        )}
      </section>
      {error && <p className="status-error today-error" role="alert">{error}</p>}
      </>}
    </div>
  )
}

function errorText(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : typeof error === 'string' && error ? error : fallback
}

function localDateTimeToIso(value: string): string | null {
  if (!value) return null
  const date = new Date(value)
  if (!Number.isFinite(date.getTime())) throw new Error('Choose a valid reminder time.')
  return date.toISOString()
}

function toLocalDateTime(value: string | null): string {
  if (!value) return ''
  const date = new Date(value)
  if (!Number.isFinite(date.getTime())) return ''
  const pad = (part: number): string => String(part).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`
}

function formatReminder(value: string): string {
  const date = new Date(value)
  if (!Number.isFinite(date.getTime())) return value
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(date)
}

function formatTaskDue(value: string): string {
  const date = new Date(value)
  if (!Number.isFinite(date.getTime())) return value
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(date)
}
