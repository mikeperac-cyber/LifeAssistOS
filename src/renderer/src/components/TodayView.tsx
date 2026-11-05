import { useEffect, useRef, useState } from 'react'
import type { GoogleTask, GoogleTaskList, PlanTask, TodaySnapshot } from '../../../shared/types'
import type { PublicGoogleCalendarSettings, PublicGoogleGmailSettings, PublicGoogleTasksSettings, PublicMicrosoftMailSettings, PublicMicrosoftTodoSettings, PublicMicrosoftCalendarSettings } from '../../../shared/ipc'
import type { TodaySearchTarget } from '../global-search'
import { MicrosoftTodoPanel } from './MicrosoftTodoPanel'
import { MicrosoftCalendarPanel } from './MicrosoftCalendarPanel'
import { GoogleCalendarPanel } from './GoogleCalendarPanel'
import { GoogleGmailFollowupPanel, OutlookMailFollowupPanel } from './EmailFollowupPanel'
import { TaskExportControl } from './TaskExportControl'
import { isRemoteTaskImported, RemoteTaskImportButton } from './RemoteTaskImportButton'

export function TodayView({ googleCalendarSettings, googleGmailSettings, googleTasksSettings, microsoftTodoSettings, microsoftCalendarSettings, microsoftMailSettings, disabled, onOpenSettings, onPrepareMeeting, onGoogleCalendarSettingsRefresh, onGoogleGmailSettingsRefresh, onSettingsRefresh, onMicrosoftTodoSettingsRefresh, onMicrosoftCalendarSettingsRefresh, onMicrosoftMailSettingsRefresh, searchTarget, onSearchTargetConsumed }: {
  googleCalendarSettings: PublicGoogleCalendarSettings | null
  googleGmailSettings: PublicGoogleGmailSettings | null
  googleTasksSettings: PublicGoogleTasksSettings | null
  microsoftTodoSettings: PublicMicrosoftTodoSettings | null
  microsoftCalendarSettings: PublicMicrosoftCalendarSettings | null
  microsoftMailSettings: PublicMicrosoftMailSettings | null
  disabled: boolean
  onOpenSettings: () => void
  onPrepareMeeting: (prompt: string) => void
  onGoogleCalendarSettingsRefresh: (settings: PublicGoogleCalendarSettings) => void
  onGoogleGmailSettingsRefresh: (settings: PublicGoogleGmailSettings) => void
  onSettingsRefresh: (settings: PublicGoogleTasksSettings) => void
  onMicrosoftTodoSettingsRefresh: (settings: PublicMicrosoftTodoSettings) => void
  onMicrosoftCalendarSettingsRefresh: (settings: PublicMicrosoftCalendarSettings) => void
  onMicrosoftMailSettingsRefresh: (settings: PublicMicrosoftMailSettings) => void
  searchTarget?: TodaySearchTarget | null
  onSearchTargetConsumed?: () => void
}): React.JSX.Element {
  const [snapshot, setSnapshot] = useState<TodaySnapshot>({ date: '', tasks: [], inbox: [] })
  const [capture, setCapture] = useState('')
  const [task, setTask] = useState('')
  const [dueDate, setDueDate] = useState('')
  const [reminderDraft, setReminderDraft] = useState('')
  const [editingReminderId, setEditingReminderId] = useState<string | null>(null)
  const [priority, setPriority] = useState<'low' | 'normal' | 'high'>('normal')
  const [error, setError] = useState('')
  const [calendarExportBusy, setCalendarExportBusy] = useState(false)
  const [calendarExportMessage, setCalendarExportMessage] = useState('')
  const [calendarExportError, setCalendarExportError] = useState(false)
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
  const [retainedSearchTarget, setRetainedSearchTarget] = useState<TodaySearchTarget | null>(searchTarget ?? null)
  const [highlightedSearchKey, setHighlightedSearchKey] = useState('')
  const searchTargetRef = useRef<HTMLDivElement>(null)
  const activeSearchTarget = searchTarget ?? retainedSearchTarget

  useEffect(() => {
    if (!searchTarget || loading || loadFailed) return
    setRetainedSearchTarget(searchTarget)
    const key = searchTarget.kind === 'today-task' ? `task:${searchTarget.task.id}` : `inbox:${searchTarget.item.id}`
    setHighlightedSearchKey(key)
    const frame = requestAnimationFrame(() => {
      searchTargetRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' })
      searchTargetRef.current?.focus({ preventScroll: true })
    })
    const timeout = window.setTimeout(() => {
      setHighlightedSearchKey((current) => current === key ? '' : current)
      onSearchTargetConsumed?.()
    }, 4500)
    return () => {
      cancelAnimationFrame(frame)
      window.clearTimeout(timeout)
    }
  }, [searchTarget, loading, loadFailed, onSearchTargetConsumed])

  const visibleTasks = activeSearchTarget?.kind === 'today-task' &&
    !snapshot.tasks.some((item) => item.id === activeSearchTarget.task.id)
    ? [...snapshot.tasks, activeSearchTarget.task]
    : snapshot.tasks
  const visibleInbox = activeSearchTarget?.kind === 'today-inbox' &&
    !snapshot.inbox.some((item) => item.id === activeSearchTarget.item.id)
    ? [...snapshot.inbox, activeSearchTarget.item]
    : snapshot.inbox

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
  useEffect(() => {
    let active = true
    void load()
    const unsubscribe = window.assist.onEvent((event) => {
      if (active && event.type === 'today_changed') void load()
    })
    return () => { active = false; unsubscribe() }
  }, [])

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

  const exportCalendar = async (): Promise<void> => {
    if (calendarExportBusy) return
    setCalendarExportBusy(true)
    setCalendarExportMessage('')
    setCalendarExportError(false)
    try {
      const result = await window.assist.exportTodayTasksCalendar()
      if (result.ok && result.fileName) {
        setCalendarExportMessage(`Exported ${result.taskCount ?? 0} task(s) to ${result.fileName}. Import the file into your calendar.`)
      } else if (!result.cancelled) {
        setCalendarExportMessage(result.error ?? 'Could not export tasks to a calendar file.')
        setCalendarExportError(true)
      }
    } catch (cause) {
      setCalendarExportMessage(errorText(cause, 'Could not export tasks to a calendar file.'))
      setCalendarExportError(true)
    } finally {
      setCalendarExportBusy(false)
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
          <div className="today-card-head">
            <h3>Next actions</h3>
            <div className="today-task-card-actions">
              <span>{visibleTasks.length}</span>
              <button
                className="ghost-button"
                type="button"
                onClick={() => void exportCalendar()}
                disabled={calendarExportBusy || !snapshot.tasks.some((item) => item.status === 'open' && item.dueDate)}
                aria-label="Export open tasks with due dates to a calendar file"
                title="Save an iCalendar file for import into another calendar app"
              >
                {calendarExportBusy ? 'Exporting…' : 'Export .ics'}
              </button>
            </div>
          </div>
          <p className="today-calendar-export-help">Save open tasks with due dates as all-day calendar events. Task notes are included; choose where to save, then import the file into your calendar app.</p>
          {calendarExportMessage && <p className={`today-calendar-export-message ${calendarExportError ? 'status-error' : 'status-success'}`} role={calendarExportError ? 'alert' : 'status'}>{calendarExportMessage}</p>}
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
            {visibleTasks.map((item) => {
              const searchKey = `task:${item.id}`
              const isSearchTarget = activeSearchTarget?.kind === 'today-task' && activeSearchTarget.task.id === item.id
              return (
              <div
                ref={isSearchTarget && highlightedSearchKey === searchKey ? searchTargetRef : undefined}
                className={`today-task priority-${item.priority} ${highlightedSearchKey === searchKey ? 'is-global-search-target' : ''}`}
                key={item.id}
                tabIndex={isSearchTarget ? -1 : undefined}
                data-global-search-target={isSearchTarget ? 'task' : undefined}
              >
                <button type="button" className="task-check" onClick={() => void complete(item.id)} aria-label={`Complete ${item.title}`}>○</button>
                <div className="today-task-copy">
                  <strong>{item.title}</strong>
                  {item.emailSource && <span className="today-task-source" title={`Message ID: ${item.emailSource.messageId}`}>From {item.emailSource.provider === 'gmail' ? 'Gmail' : 'Outlook'}</span>}
                  {item.calendarSource && <span className="today-task-source">From {item.calendarSource.provider === 'google_calendar' ? 'Google Calendar' : 'Outlook Calendar'}</span>}
                  {item.remoteTaskSource && <span className="today-task-source">Copied from {item.remoteTaskSource.provider === 'google_tasks' ? 'Google Tasks' : 'Microsoft To Do'}</span>}
                  {item.taskExports?.map((exported) => (
                    <span className={`today-task-export export-${exportStatusTone(exported, item)}`} key={`${exported.provider}:${exported.taskListId}`} title={exportStatusTitle(exported, item)}>
                      {exported.provider === 'google_tasks' ? 'Google Tasks' : 'Microsoft To Do'} · {exportStatusLabel(exported, item)}
                    </span>
                  ))}
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
            )})}
            {visibleTasks.length === 0 && <p className="muted">No open tasks due today. Add one when it becomes real.</p>}
          </div>
        </section>

        <section className="today-card today-inbox">
          <div className="today-card-head"><h3>Inbox</h3><span>{visibleInbox.length}</span></div>
          <div className="inbox-add">
            <input value={capture} onChange={(event) => setCapture(event.target.value)} placeholder="Capture a thought…" aria-label="Inbox capture" onKeyDown={(event) => { if (event.key === 'Enter') void addCapture() }} />
            <button className="ghost-button" type="button" disabled={!capture.trim()} onClick={() => void addCapture()}>Capture</button>
          </div>
          <div className="inbox-list">
            {visibleInbox.map((item) => {
              const searchKey = `inbox:${item.id}`
              const isSearchTarget = activeSearchTarget?.kind === 'today-inbox' && activeSearchTarget.item.id === item.id
              return (
              <div
                ref={isSearchTarget && highlightedSearchKey === searchKey ? searchTargetRef : undefined}
                className={`inbox-item ${highlightedSearchKey === searchKey ? 'is-global-search-target' : ''}`}
                key={item.id}
                tabIndex={isSearchTarget ? -1 : undefined}
                data-global-search-target={isSearchTarget ? 'inbox' : undefined}
              >
                <p>{item.text}</p>
                <div><button className="ghost-button" type="button" onClick={() => void convert(item.id)}>Make task</button><button className="danger-button" type="button" onClick={() => void dismiss(item.id)}>Dismiss</button></div>
              </div>
            )})}
            {visibleInbox.length === 0 && <p className="muted">The inbox is clear.</p>}
          </div>
        </section>
      </div>
      <section className="today-card today-google-tasks" aria-labelledby="google-tasks-title">
        <div className="today-card-head">
          <h3 id="google-tasks-title">Google Tasks</h3>
          {googleTasksSettings?.connected && googleTasks.length > 0 && <span>{googleTasks.length} open</span>}
        </div>
        <p className="today-google-tasks-note">Load a list to copy an open task into local Today or send a local task here. Copying is one-time; later provider edits do not sync. Each provider read, send, and linked-task update asks for separate approval. Updates check the saved remote version before writing; Google Tasks does not store local priority. Chat may send approved task details to your configured model provider.</p>
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
            {googleTaskListsLoaded && selectedGoogleTaskListId && (
              <TaskExportControl
                provider="google_tasks"
                providerLabel="Google Tasks"
                canWrite={googleTasksSettings.taskWriteEnabled}
                taskListId={selectedGoogleTaskListId}
                taskListTitle={googleTaskLists.find((list) => list.id === selectedGoogleTaskListId)?.title ?? ''}
                tasks={snapshot.tasks}
                disabled={disabled || googleTasksReadBusy}
                onOpenSettings={onOpenSettings}
              />
            )}
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
                    <RemoteTaskImportButton
                      provider="google_tasks"
                      taskListId={selectedGoogleTaskListId}
                      task={item}
                      alreadyImported={isRemoteTaskImported(snapshot.tasks, 'google_tasks', selectedGoogleTaskListId, item.id)}
                      disabled={disabled || googleTasksReadBusy}
                      onSnapshot={setSnapshot}
                    />
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
      <MicrosoftTodoPanel
        settings={microsoftTodoSettings}
        todayTasks={snapshot.tasks}
        disabled={disabled}
        onOpenSettings={onOpenSettings}
        onSettingsRefresh={onMicrosoftTodoSettingsRefresh}
        onSnapshot={setSnapshot}
      />
      <GoogleCalendarPanel
        settings={googleCalendarSettings}
        todayTasks={snapshot.tasks}
        disabled={disabled}
        onOpenSettings={onOpenSettings}
        onPrepareMeeting={onPrepareMeeting}
        onSettingsRefresh={onGoogleCalendarSettingsRefresh}
      />
      <MicrosoftCalendarPanel
        settings={microsoftCalendarSettings}
        todayTasks={snapshot.tasks}
        disabled={disabled}
        onOpenSettings={onOpenSettings}
        onPrepareMeeting={onPrepareMeeting}
        onSettingsRefresh={onMicrosoftCalendarSettingsRefresh}
      />
      <GoogleGmailFollowupPanel
        settings={googleGmailSettings}
        todayTasks={snapshot.tasks}
        disabled={disabled}
        onOpenSettings={onOpenSettings}
        onSettingsRefresh={onGoogleGmailSettingsRefresh}
      />
      <OutlookMailFollowupPanel
        settings={microsoftMailSettings}
        todayTasks={snapshot.tasks}
        disabled={disabled}
        onOpenSettings={onOpenSettings}
        onSettingsRefresh={onMicrosoftMailSettingsRefresh}
      />
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

type TaskExportViewRecord = NonNullable<PlanTask['taskExports']>[number]

function exportStatusLabel(record: TaskExportViewRecord, task: PlanTask): string {
  if (record.status === 'sent') {
    if (record.syncStatus === 'sending') return 'updating'
    if (record.syncStatus === 'uncertain') return 'check sync'
    if (!record.syncedLocalUpdatedAt) return 'older link'
    if (!record.remoteEtag || (record.provider === 'microsoft_todo' && record.syncedPriority === undefined)) return 'update unavailable'
    if (record.syncStatus === 'failed' && !taskDiffersFromExportBaseline(task, record)) return 'review remote'
    if (taskDiffersFromExportBaseline(task, record)) return 'update available'
    return 'up to date'
  }
  if (record.status === 'sending') return 'sending'
  if (record.status === 'uncertain') return 'check before retry'
  return 'not sent'
}

function exportStatusTone(record: TaskExportViewRecord, task: PlanTask): string {
  if (record.status === 'sent' && record.syncStatus === 'uncertain') return 'uncertain'
  if (record.status === 'sent' && record.syncStatus === 'failed') return 'failed'
  if (record.status === 'sent' && taskDiffersFromExportBaseline(task, record)) return 'needs-sync'
  return record.status
}

function exportStatusTitle(record: TaskExportViewRecord, task: PlanTask): string {
  if (record.status === 'sent') {
    if (record.syncStatus === 'uncertain') return 'The remote update may have applied. Check the linked task before clearing the sync retry guard.'
    if (record.syncStatus === 'failed') return taskDiffersFromExportBaseline(task, record)
      ? 'The remote update failed or found a conflict. Review the provider version, then approve an update again if the local copy should replace it.'
      : 'The update was stopped; review the linked provider task before proceeding.'
    if (!record.syncedLocalUpdatedAt) return 'This older link has no saved version baseline, so Mike Assist cannot update it safely.'
    if (!record.remoteEtag || (record.provider === 'microsoft_todo' && record.syncedPriority === undefined)) return 'The provider did not return a complete version baseline, so Mike Assist cannot update this task safely.'
    if (taskDiffersFromExportBaseline(task, record)) return 'This local task changed after it was last copied. Review an update to the linked task.'
    return 'The local and linked task versions are up to date.'
  }
  if (record.status === 'uncertain') return 'The remote service may have created this task. Check its list before clearing the retry guard.'
  if (record.status === 'failed') return 'The service rejected the create request. A new approved send can retry it.'
  if (record.status === 'sending') return 'The task is being sent.'
  return 'The task has not been sent to the provider yet.'
}

function taskDiffersFromExportBaseline(task: PlanTask, record: TaskExportViewRecord): boolean {
  if (!record.syncedLocalUpdatedAt || record.syncedTitle === undefined || record.syncedNotes === undefined) return false
  const titleLimit = record.provider === 'google_tasks' ? 1_024 : 240
  const title = task.title.replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, titleLimit)
  const notes = task.notes.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, ' ').trim().slice(0, 4_000)
  return title !== record.syncedTitle || notes !== record.syncedNotes || task.dueDate !== (record.syncedDueDate ?? null) ||
    (record.provider === 'microsoft_todo' && record.syncedPriority !== undefined && task.priority !== record.syncedPriority)
}
