import { useRef, useState } from 'react'
import type { PlanTask, PlanTaskPriority, TaskProject, TaskRecurrenceFrequency, TaskRecurrenceInput, TaskWorkflowStage } from '../../../shared/types'
import { AccessibleDialog } from './AccessibleDialog'

export interface TaskEditorValues {
  title: string
  notes: string
  dueDate: string | null
  scheduledStart: string | null
  durationMinutes: number | null
  remindAt: string | null
  priority: PlanTaskPriority
  projectId: string | null
  workflowStage: TaskWorkflowStage
  recurrenceRule: TaskRecurrenceInput | null
}

export function TaskEditorDialog({
  task,
  initialTitle = '',
  initialNotes = '',
  initialDueDate = null,
  initialPriority = 'normal',
  projects = [],
  initialProjectId = null,
  allowRecurrence = true,
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
  projects?: TaskProject[]
  initialProjectId?: string | null
  allowRecurrence?: boolean
  heading: string
  saveLabel?: string
  onClose: () => void
  onSave: (values: TaskEditorValues) => Promise<void>
}): React.JSX.Element {
  const titleRef = useRef<HTMLInputElement>(null)
  const [title, setTitle] = useState(task?.title ?? initialTitle)
  const [notes, setNotes] = useState(task?.notes ?? initialNotes)
  const [dueDate, setDueDate] = useState(task?.dueDate ?? initialDueDate ?? '')
  const [scheduledStart, setScheduledStart] = useState(task?.scheduledStart ?? '')
  const [durationMinutes, setDurationMinutes] = useState(task?.durationMinutes ?? 30)
  const [reminder, setReminder] = useState(toLocalDateTime(task?.remindAt ?? null))
  const [priority, setPriority] = useState<PlanTaskPriority>(task?.priority ?? initialPriority)
  const [projectId, setProjectId] = useState(task?.projectId ?? initialProjectId ?? '')
  const [workflowStage, setWorkflowStage] = useState<TaskWorkflowStage>(task?.workflowStage ?? 'next')
  const [repeatFrequency, setRepeatFrequency] = useState<TaskRecurrenceFrequency | 'none'>(task?.recurrenceRule?.frequency ?? 'none')
  const [repeatWeekdays, setRepeatWeekdays] = useState<number[]>(task?.recurrenceRule?.weekdays ?? (task?.dueDate ? [weekdayForDate(task.dueDate)] : [new Date().getDay()]))
  const [repeatEndsOn, setRepeatEndsOn] = useState(task?.recurrenceRule?.endsOn ?? '')
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
    if (repeatFrequency !== 'none' && !dueDate) {
      setError('Add a due date before setting a repeat rule.')
      return
    }
    if (repeatFrequency === 'weekly' && repeatWeekdays.length === 0) {
      setError('Choose at least one weekday for a weekly repeat.')
      return
    }
    setSaving(true)
    setError('')
    try {
      await onSave({
        title: cleanTitle,
        notes: notes.trim(),
        dueDate: dueDate || null,
        scheduledStart: scheduledStart || null,
        durationMinutes: scheduledStart ? durationMinutes : null,
        remindAt: toIsoDateTime(reminder),
        priority,
        projectId: projectId || null,
        workflowStage,
        recurrenceRule: repeatFrequency === 'none' ? null : {
          frequency: repeatFrequency,
          ...(repeatFrequency === 'weekly' ? { weekdays: [...repeatWeekdays].sort((a, b) => a - b) } : {}),
          ...(repeatEndsOn ? { endsOn: repeatEndsOn } : {})
        }
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
            <input type="date" value={dueDate} required={repeatFrequency !== 'none'} onChange={(event) => setDueDate(event.target.value)} />
          </label>
          <label className="field">
            <span className="field-label">Reminder</span>
            <input type="datetime-local" value={reminder} onChange={(event) => setReminder(event.target.value)} />
          </label>
          <label className="field">
            <span className="field-label">Plan time</span>
            <input type="datetime-local" value={scheduledStart} onChange={(event) => setScheduledStart(event.target.value)} />
          </label>
          {scheduledStart && <label className="field">
            <span className="field-label">Duration</span>
            <select value={durationMinutes} onChange={(event) => setDurationMinutes(Number(event.target.value))}>
              {[15, 30, 45, 60, 90, 120].map((minutes) => <option key={minutes} value={minutes}>{minutes < 60 ? `${minutes} minutes` : `${minutes / 60} hour${minutes === 60 ? '' : 's'}`}</option>)}
            </select>
          </label>}
          <label className="field">
            <span className="field-label">Priority</span>
            <select value={priority} onChange={(event) => setPriority(event.target.value as PlanTaskPriority)}>
              <option value="low">Low</option>
              <option value="normal">Normal</option>
              <option value="high">High</option>
            </select>
          </label>
        </div>
        {allowRecurrence && <section className="task-repeat-fields" aria-label="Repeat schedule">
          <label className="field">
            <span className="field-label">Repeat</span>
            <select value={repeatFrequency} onChange={(event) => {
              const next = event.target.value as TaskRecurrenceFrequency | 'none'
              setRepeatFrequency(next)
              if (next === 'weekly' && repeatWeekdays.length === 0) setRepeatWeekdays([dueDate ? weekdayForDate(dueDate) : new Date().getDay()])
            }}>
              <option value="none">Does not repeat</option>
              <option value="daily">Every day</option>
              <option value="weekly">Selected weekdays</option>
              <option value="monthly">Every month</option>
            </select>
          </label>
          {repeatFrequency === 'weekly' && <fieldset className="repeat-weekdays">
            <legend className="field-label">Repeat on</legend>
            {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((label, day) => <label key={day} className="repeat-weekday">
              <input type="checkbox" checked={repeatWeekdays.includes(day)} onChange={(event) => setRepeatWeekdays((current) => event.target.checked ? [...new Set([...current, day])] : current.filter((item) => item !== day))} />
              <span>{label}</span>
            </label>)}
          </fieldset>}
          {repeatFrequency !== 'none' && <label className="field repeat-end-date">
            <span className="field-label">Ends on <span className="field-optional">optional</span></span>
            <input type="date" min={dueDate || undefined} value={repeatEndsOn} onChange={(event) => setRepeatEndsOn(event.target.value)} />
          </label>}
        </section>}
        <div className="form-grid task-editor-project-fields">
          <label className="field">
            <span className="field-label">Project</span>
            <select value={projectId} onChange={(event) => setProjectId(event.target.value)}>
              <option value="">No project</option>
              {projects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}
            </select>
          </label>
          <label className="field">
            <span className="field-label">Project stage</span>
            <select value={workflowStage} onChange={(event) => setWorkflowStage(event.target.value as TaskWorkflowStage)}>
              <option value="next">Next</option><option value="in-progress">In progress</option><option value="waiting">Waiting</option>
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

function weekdayForDate(value: string): number {
  const [year, month, day] = value.split('-').map(Number)
  return new Date(Date.UTC(year, month - 1, day)).getUTCDay()
}
