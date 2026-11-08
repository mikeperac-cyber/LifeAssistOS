import { useRef, useState } from 'react'
import type { PlanTask, PlanTaskPriority } from '../../../shared/types'
import { AccessibleDialog } from './AccessibleDialog'

export interface TaskEditorValues {
  title: string
  notes: string
  dueDate: string | null
  remindAt: string | null
  priority: PlanTaskPriority
}

export function TaskEditorDialog({
  task,
  initialTitle = '',
  initialNotes = '',
  initialDueDate = null,
  initialPriority = 'normal',
  heading,
  saveLabel = 'Save task',
  onClose,
  onSave
}: {
  task?: PlanTask
  initialTitle?: string
  initialNotes?: string
  initialDueDate?: string | null
  initialPriority?: PlanTaskPriority
  heading: string
  saveLabel?: string
  onClose: () => void
  onSave: (values: TaskEditorValues) => Promise<void>
}): React.JSX.Element {
  const titleRef = useRef<HTMLInputElement>(null)
  const [title, setTitle] = useState(task?.title ?? initialTitle)
  const [notes, setNotes] = useState(task?.notes ?? initialNotes)
  const [dueDate, setDueDate] = useState(task?.dueDate ?? initialDueDate ?? '')
  const [reminder, setReminder] = useState(toLocalDateTime(task?.remindAt ?? null))
  const [priority, setPriority] = useState<PlanTaskPriority>(task?.priority ?? initialPriority)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  async function submit(event: React.FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault()
    if (saving) return
    const cleanTitle = title.trim()
    if (!cleanTitle) {
      setError('A task needs a title.')
      titleRef.current?.focus()
      return
    }
    setSaving(true)
    setError('')
    try {
      await onSave({
        title: cleanTitle,
        notes: notes.trim(),
        dueDate: dueDate || null,
        remindAt: toIsoDateTime(reminder),
        priority
      })
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setSaving(false)
    }
  }

  return (
    <AccessibleDialog className="modal task-editor-dialog" labelledBy="task-editor-title" describedBy="task-editor-description" initialFocusRef={titleRef} onCancel={onClose}>
      <div className="modal-top"><span className="modal-kicker">Task details</span></div>
      <h2 id="task-editor-title">{heading}</h2>
      <p id="task-editor-description" className="modal-summary">Keep the deadline, reminder, and priority specific to this task.</p>
      <form className="task-editor-form" onSubmit={(event) => void submit(event)}>
        <label className="field field-wide">
          <span className="field-label">Task</span>
          <input ref={titleRef} value={title} maxLength={240} autoFocus onChange={(event) => setTitle(event.target.value)} />
        </label>
        <label className="field field-wide">
          <span className="field-label">Notes</span>
          <textarea value={notes} maxLength={2000} rows={4} onChange={(event) => setNotes(event.target.value)} />
        </label>
        <div className="form-grid task-editor-schedule">
          <label className="field">
            <span className="field-label">Due date</span>
            <input type="date" value={dueDate} onChange={(event) => setDueDate(event.target.value)} />
          </label>
          <label className="field">
            <span className="field-label">Reminder</span>
            <input type="datetime-local" value={reminder} onChange={(event) => setReminder(event.target.value)} />
          </label>
          <label className="field">
            <span className="field-label">Priority</span>
            <select value={priority} onChange={(event) => setPriority(event.target.value as PlanTaskPriority)}>
              <option value="low">Low</option>
              <option value="normal">Normal</option>
              <option value="high">High</option>
            </select>
          </label>
        </div>
        {error && <p className="task-editor-error" role="alert">{error}</p>}
        <div className="modal-actions">
          <button className="btn btn-ghost" type="button" onClick={onClose} disabled={saving}>Cancel</button>
          <button className="btn btn-primary" type="submit" disabled={saving}>{saving ? 'Saving…' : saveLabel}</button>
        </div>
      </form>
    </AccessibleDialog>
  )
}

function toLocalDateTime(value: string | null): string {
  if (!value) return ''
  const date = new Date(value)
  if (!Number.isFinite(date.getTime())) return ''
  const pad = (part: number): string => String(part).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`
}

function toIsoDateTime(value: string): string | null {
  if (!value) return null
  const date = new Date(value)
  return Number.isFinite(date.getTime()) ? date.toISOString() : null
}
