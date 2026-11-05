import { useEffect, useRef, useState } from 'react'
import type { MicrosoftTodoTask, MicrosoftTodoTaskList, PlanTask } from '../../../shared/types'
import type { PublicMicrosoftTodoSettings } from '../../../shared/ipc'
import { TaskExportControl } from './TaskExportControl'

export function MicrosoftTodoPanel({ settings, todayTasks, disabled, onOpenSettings, onSettingsRefresh }: {
  settings: PublicMicrosoftTodoSettings | null
  todayTasks: PlanTask[]
  disabled: boolean
  onOpenSettings: () => void
  onSettingsRefresh: (settings: PublicMicrosoftTodoSettings) => void
}): React.JSX.Element {
  const [lists, setLists] = useState<MicrosoftTodoTaskList[]>([])
  const [listsLoaded, setListsLoaded] = useState(false)
  const [listsPageToken, setListsPageToken] = useState<string | undefined>()
  const [selectedListId, setSelectedListId] = useState('')
  const [tasks, setTasks] = useState<MicrosoftTodoTask[]>([])
  const [tasksLoaded, setTasksLoaded] = useState(false)
  const [tasksPageToken, setTasksPageToken] = useState<string | undefined>()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const busyRef = useRef(false)

  useEffect(() => {
    if (settings?.connected) return
    setLists([])
    setListsLoaded(false)
    setListsPageToken(undefined)
    setSelectedListId('')
    setTasks([])
    setTasksLoaded(false)
    setTasksPageToken(undefined)
    setError('')
  }, [settings?.connected])

  const loadLists = async (pageToken?: string): Promise<void> => {
    if (busyRef.current) return
    busyRef.current = true
    setBusy(true)
    setError('')
    try {
      const result = await window.assist.listMicrosoftTodoTaskLists(pageToken)
      if (result.settings) onSettingsRefresh(result.settings)
      if (!result.ok || !result.lists) throw new Error(result.error ?? 'Could not load Microsoft To Do lists.')
      setLists((current) => pageToken ? [...current, ...result.lists!] : result.lists!)
      setListsLoaded(true)
      setListsPageToken(result.nextPageToken)
      if (!pageToken) {
        setSelectedListId((current) => current && result.lists!.some((list) => list.id === current) ? current : result.lists![0]?.id ?? '')
        setTasks([])
        setTasksLoaded(false)
        setTasksPageToken(undefined)
      }
    } catch (cause) {
      setError(errorText(cause, 'Could not load Microsoft To Do lists.'))
    } finally {
      busyRef.current = false
      setBusy(false)
    }
  }

  const loadTasks = async (pageToken?: string): Promise<void> => {
    if (!selectedListId || busyRef.current) return
    busyRef.current = true
    setBusy(true)
    setError('')
    try {
      const result = await window.assist.listMicrosoftTodoTasks(selectedListId, pageToken)
      if (result.settings) onSettingsRefresh(result.settings)
      if (!result.ok || !result.tasks) throw new Error(result.error ?? 'Could not load Microsoft To Do tasks.')
      setTasks((current) => pageToken ? [...current, ...result.tasks!] : result.tasks!)
      setTasksLoaded(true)
      setTasksPageToken(result.nextPageToken)
    } catch (cause) {
      setError(errorText(cause, 'Could not load Microsoft To Do tasks.'))
    } finally {
      busyRef.current = false
      setBusy(false)
    }
  }

  return (
    <section className="today-card today-google-tasks" aria-labelledby="microsoft-todo-title">
      <div className="today-card-head">
        <h3 id="microsoft-todo-title">Microsoft To Do</h3>
        {settings?.connected && tasks.length > 0 && <span>{tasks.length} open</span>}
      </div>
      <p className="today-google-tasks-note">Load a destination list, then send a local task here or ask in Chat. Each read, send, and linked-task update asks for separate approval. Updates check the saved remote version before writing. Chat may send approved task details to your configured model provider.</p>
      {settings === null ? (
        <p className="muted" role="status">Checking Microsoft To Do connection…</p>
      ) : !settings.connected ? (
        <div className="today-google-tasks-empty">
          <p>Connect Microsoft To Do to view a list alongside your local tasks.</p>
          <button className="ghost-button" type="button" onClick={onOpenSettings} disabled={disabled}>Open Settings</button>
        </div>
      ) : (
        <>
          <div className="today-google-tasks-controls">
            <button className="ghost-button" type="button" onClick={() => void loadLists()} disabled={disabled || busy}>
              {busy ? 'Waiting…' : listsLoaded ? 'Refresh lists' : 'Load task lists'}
            </button>
            {lists.length > 0 && <>
              <label className="today-google-task-list-select">
                <span className="sr-only">Microsoft To Do list</span>
                <select
                  value={selectedListId}
                  disabled={disabled || busy}
                  onChange={(event) => {
                    setSelectedListId(event.target.value)
                    setTasks([])
                    setTasksLoaded(false)
                    setTasksPageToken(undefined)
                    setError('')
                  }}
                >
                  {lists.map((list) => <option key={list.id} value={list.id}>{list.title}</option>)}
                </select>
              </label>
              <button className="ghost-button" type="button" onClick={() => void loadTasks()} disabled={disabled || busy || !selectedListId}>
                {busy ? 'Waiting…' : 'Load open tasks'}
              </button>
            </>}
            {listsPageToken && <button className="ghost-button" type="button" onClick={() => void loadLists(listsPageToken)} disabled={disabled || busy}>Load more lists</button>}
          </div>
          {listsLoaded && selectedListId && (
            <TaskExportControl
              provider="microsoft_todo"
              providerLabel="Microsoft To Do"
              canWrite={settings.taskWriteEnabled}
              taskListId={selectedListId}
              taskListTitle={lists.find((list) => list.id === selectedListId)?.title ?? ''}
              tasks={todayTasks}
              disabled={disabled || busy}
              onOpenSettings={onOpenSettings}
            />
          )}
          {listsLoaded && lists.length === 0 && <p className="muted">No Microsoft To Do lists were found.</p>}
          {tasks.length > 0 ? (
            <div className="today-google-task-list">
              {tasks.map((item) => <article className="today-google-task" key={`${selectedListId}:${item.id}`}>
                <div className="today-google-task-copy">
                  <strong>{item.title}</strong>
                  {item.due && <span>Due {formatTaskDue(item.due)}</span>}
                  {item.notes && <p>{item.notes}{item.notesTruncated && <span> Note shortened to 4,000 characters.</span>}</p>}
                </div>
                <span className="today-google-task-status">{formatTaskStatus(item.status)}</span>
              </article>)}
            </div>
          ) : tasksLoaded ? (
            <p className="muted">No open Microsoft To Do tasks were found on this page.</p>
          ) : listsLoaded && lists.length > 0 ? (
            <p className="muted">Choose a list, then load its open tasks.</p>
          ) : null}
          {tasksPageToken && <button className="ghost-button" type="button" onClick={() => void loadTasks(tasksPageToken)} disabled={disabled || busy}>Load more tasks</button>}
          {error && <p className="status-error" role="alert">{error}</p>}
        </>
      )}
    </section>
  )
}

function errorText(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : typeof error === 'string' && error ? error : fallback
}

function formatTaskDue(value: string): string {
  const date = new Date(`${value}T00:00:00`)
  return Number.isFinite(date.getTime()) ? new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(date) : value
}

function formatTaskStatus(status: MicrosoftTodoTask['status']): string {
  switch (status) {
    case 'inProgress': return 'In progress'
    case 'waitingOnOthers': return 'Waiting on others'
    case 'deferred': return 'Deferred'
    case 'completed': return 'Completed'
    default: return 'Open'
  }
}
