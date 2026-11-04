import { useEffect, useState } from 'react'
import type { PlanTask, TodaySnapshot } from '../../../shared/types'

export function TodayView(): React.JSX.Element {
  const [snapshot, setSnapshot] = useState<TodaySnapshot>({ date: '', tasks: [], inbox: [] })
  const [capture, setCapture] = useState('')
  const [task, setTask] = useState('')
  const [dueDate, setDueDate] = useState('')
  const [reminderDraft, setReminderDraft] = useState('')
  const [editingReminderId, setEditingReminderId] = useState<string | null>(null)
  const [priority, setPriority] = useState<'low' | 'normal' | 'high'>('normal')
  const [error, setError] = useState('')

  const load = async (): Promise<void> => setSnapshot(await window.assist.getToday())
  useEffect(() => { void load() }, [])

  const addCapture = async (): Promise<void> => {
    const result = await window.assist.captureInbox(capture)
    if (result.snapshot) { setSnapshot(result.snapshot); setCapture(''); setError('') }
    else setError(result.error ?? 'Could not capture that.')
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
      setError(cause instanceof Error ? cause.message : 'Choose a valid reminder time.')
    }
  }

  const complete = async (id: string): Promise<void> => {
    const result = await window.assist.updatePlanTask(id, { status: 'done' })
    if (result.snapshot) { setSnapshot(result.snapshot); setError('') }
    else setError(result.error ?? 'Could not complete that task.')
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
      setError(cause instanceof Error ? cause.message : 'Choose a valid reminder time.')
    }
  }

  const clearReminder = async (item: PlanTask): Promise<void> => {
    const result = await window.assist.updatePlanTask(item.id, { remindAt: null })
    if (result.snapshot) {
      setSnapshot(result.snapshot)
      setEditingReminderId(null)
      setReminderDraft('')
      setError('')
    } else setError(result.error ?? 'Could not clear that reminder.')
  }

  const convert = async (id: string): Promise<void> => {
    const result = await window.assist.convertInbox(id)
    if (result.snapshot) { setSnapshot(result.snapshot); setError('') }
    else setError(result.error ?? 'Could not convert that inbox item.')
  }

  const dismiss = async (id: string): Promise<void> => {
    const result = await window.assist.dismissInbox(id)
    if (result.snapshot) { setSnapshot(result.snapshot); setError('') }
    else setError(result.error ?? 'Could not dismiss that inbox item.')
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
        <span className="today-date">{snapshot.date}</span>
      </div>

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
      {error && <p className="status-error today-error">{error}</p>}
    </div>
  )
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
