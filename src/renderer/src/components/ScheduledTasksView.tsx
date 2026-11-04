import { useState } from 'react'
import type { ChatMode, ScheduledAgentTask, ScheduledTaskSchedule } from '../../../shared/types'
import type { ScheduledTaskMutationResult, ScheduledTaskRunResult } from '../../../shared/ipc'

type ScheduleKind = ScheduledTaskSchedule['kind']

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
const MODE_LABELS: Record<ChatMode, string> = {
  assistant: 'Assistant',
  brainstorm: 'Brainstorm',
  software: 'Software',
  review: 'Review',
  coach_personal: 'Personal coach',
  coach_business: 'Business coach'
}

function scheduleLabel(schedule: ScheduledTaskSchedule): string {
  if (schedule.kind === 'once') {
    return `Once · ${new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(schedule.at))}`
  }
  if (schedule.kind === 'daily') return `Daily · ${schedule.time}`
  if (schedule.kind === 'weekdays') return `Weekdays · ${schedule.time}`
  return `Every ${DAY_NAMES[schedule.weekday]} · ${schedule.time}`
}

function dateLabel(value: string | null): string {
  return value ? new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value)) : 'No further run'
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export function ScheduledTasksView({
  tasks,
  disabled,
  onCreate,
  onSetEnabled,
  onRemove,
  onRun
}: {
  tasks: ScheduledAgentTask[]
  disabled: boolean
  onCreate: (input: { name: string; prompt: string; mode: ChatMode; schedule: ScheduledTaskSchedule }) => Promise<ScheduledTaskMutationResult>
  onSetEnabled: (id: string, enabled: boolean) => Promise<ScheduledTaskMutationResult>
  onRemove: (id: string) => Promise<ScheduledTaskMutationResult>
  onRun: (id: string) => Promise<ScheduledTaskRunResult>
}): React.JSX.Element {
  const [name, setName] = useState('')
  const [prompt, setPrompt] = useState('')
  const [mode, setMode] = useState<ChatMode>('coach_personal')
  const [kind, setKind] = useState<ScheduleKind>('daily')
  const [time, setTime] = useState('08:30')
  const [weekday, setWeekday] = useState(1)
  const [onceAt, setOnceAt] = useState('')
  const [status, setStatus] = useState('')
  const [busy, setBusy] = useState(false)
  const [runningId, setRunningId] = useState<string | null>(null)
  const [confirmRemoveId, setConfirmRemoveId] = useState<string | null>(null)

  function currentSchedule(): ScheduledTaskSchedule | null {
    if (kind === 'once') {
      const localDate = new Date(onceAt)
      return onceAt && Number.isFinite(localDate.getTime()) ? { kind: 'once', at: localDate.toISOString() } : null
    }
    if (kind === 'weekly') return { kind, weekday, time }
    return { kind, time }
  }

  async function create(event: React.FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault()
    const schedule = currentSchedule()
    if (!schedule) {
      setStatus('Choose a valid date and time for the one-time task.')
      return
    }
    setBusy(true)
    setStatus('')
    try {
      const result = await onCreate({ name, prompt, mode, schedule })
      if (result.ok) {
        setName('')
        setPrompt('')
        setStatus('Scheduled task saved. It will run while Mike Assist is open.')
      } else {
        setStatus(result.error ?? 'Could not create the scheduled task.')
      }
    } catch (error) {
      setStatus(errorText(error))
    } finally {
      setBusy(false)
    }
  }

  async function toggle(task: ScheduledAgentTask): Promise<void> {
    setBusy(true)
    setStatus('')
    try {
      const result = await onSetEnabled(task.id, !task.enabled)
      setStatus(result.ok ? (task.enabled ? 'Schedule paused.' : 'Schedule resumed.') : result.error ?? 'Could not update the schedule.')
    } catch (error) {
      setStatus(errorText(error))
    } finally {
      setBusy(false)
    }
  }

  async function remove(task: ScheduledAgentTask): Promise<void> {
    if (confirmRemoveId !== task.id) {
      setConfirmRemoveId(task.id)
      return
    }
    setBusy(true)
    setStatus('')
    try {
      const result = await onRemove(task.id)
      setStatus(result.ok ? 'Scheduled task removed.' : result.error ?? 'Could not remove the scheduled task.')
    } catch (error) {
      setStatus(errorText(error))
    } finally {
      setBusy(false)
      setConfirmRemoveId(null)
    }
  }

  async function run(task: ScheduledAgentTask): Promise<void> {
    setRunningId(task.id)
    setStatus('')
    try {
      const result = await onRun(task.id)
      setStatus(result.ok ? `“${task.name}” finished.` : result.error ?? 'The scheduled task did not finish.')
    } catch (error) {
      setStatus(errorText(error))
    } finally {
      setRunningId(null)
    }
  }

  return (
    <div className="scheduled-view">
      <header className="scheduled-header">
        <div>
          <div className="eyebrow">AUTOMATIC CHECK-INS</div>
          <h2>Scheduled tasks</h2>
          <p>Each run sends the saved prompt and approved tool results to your configured model. Prompts and latest results stay in local app data and backups, outside chat history. Writes and external actions still need approval; commands and nested schedules are disabled.</p>
        </div>
      </header>

      <form className="scheduled-form" onSubmit={(event) => void create(event)}>
        <div className="scheduled-form-title">
          <h3>Create a scheduled check-in</h3>
          <span>Mike Assist must be open for scheduled runs.</span>
        </div>
        <label>
          Task name
          <input value={name} onChange={(event) => setName(event.target.value)} maxLength={100} minLength={2} required placeholder="Morning plan" disabled={busy || disabled} />
        </label>
        <label>
          Instructions
          <textarea value={prompt} onChange={(event) => setPrompt(event.target.value)} maxLength={6000} minLength={5} required rows={4} placeholder="Review my open tasks and personal goals. Help me choose three realistic priorities for today." disabled={busy || disabled} />
        </label>
        <div className="scheduled-form-row">
          <label>
            Assistant mode
            <select value={mode} onChange={(event) => setMode(event.target.value as ChatMode)} disabled={busy || disabled}>
              {Object.entries(MODE_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
          </label>
          <label>
            Repeat
            <select value={kind} onChange={(event) => setKind(event.target.value as ScheduleKind)} disabled={busy || disabled}>
              <option value="daily">Every day</option>
              <option value="weekdays">Weekdays</option>
              <option value="weekly">Every week</option>
              <option value="once">One time</option>
            </select>
          </label>
          {kind === 'weekly' && (
            <label>
              Day
              <select value={weekday} onChange={(event) => setWeekday(Number(event.target.value))} disabled={busy || disabled}>
                {DAY_NAMES.map((day, index) => <option key={day} value={index}>{day}</option>)}
              </select>
            </label>
          )}
          {kind === 'once' ? (
            <label>
              Run at
              <input type="datetime-local" value={onceAt} onChange={(event) => setOnceAt(event.target.value)} required disabled={busy || disabled} />
            </label>
          ) : (
            <label>
              Local time
              <input type="time" value={time} onChange={(event) => setTime(event.target.value)} required disabled={busy || disabled} />
            </label>
          )}
        </div>
        <div className="scheduled-form-actions">
          <button className="primary-button" type="submit" disabled={busy || disabled}>{busy ? 'Saving…' : 'Save schedule'}</button>
          <span>Use Personal coach for life check-ins or Business coach for LB English reviews.</span>
        </div>
      </form>

      {status && <div className="workflow-status" role="status">{status}</div>}

      {tasks.length === 0 ? (
        <div className="finance-empty scheduled-empty">No scheduled tasks yet. Create a morning plan, a weekly business review, or a one-time follow-up above.</div>
      ) : (
        <div className="scheduled-list">
          {tasks.map((task) => {
            const completedOnce = task.schedule.kind === 'once' && !task.enabled && task.nextRunAt === null && task.runCount > 0
            const stateLabel = completedOnce ? (task.lastOutcome === 'failed' ? 'Failed' : 'Done') : task.enabled ? 'Active' : 'Paused'
            return (
              <article className="scheduled-card" key={task.id}>
              <div className="scheduled-card-head">
                <div>
                  <h3>{task.name}</h3>
                  <p>{task.prompt}</p>
                </div>
                <span className={`scheduled-state ${task.enabled ? 'enabled' : 'paused'}`}>{stateLabel}</span>
              </div>
              <div className="scheduled-meta">
                <span>{scheduleLabel(task.schedule)}</span>
                <span>{MODE_LABELS[task.mode]}</span>
                <span>{completedOnce ? 'Finished' : `Next · ${task.enabled ? dateLabel(task.nextRunAt) : 'Paused'}`}</span>
                <span>{task.runCount} {task.runCount === 1 ? 'run' : 'runs'}</span>
              </div>
              {task.lastSummary && (
                <div className="scheduled-result">
                  <span>{task.lastOutcome === 'failed' ? 'Last run failed' : 'Last result'} · {dateLabel(task.lastRunAt)}</span>
                  <p>{task.lastSummary}</p>
                  {task.lastError && <small>{task.lastError}</small>}
                </div>
              )}
              <div className="workflow-actions">
                <button className="primary-button" type="button" disabled={disabled || busy || Boolean(runningId)} onClick={() => void run(task)}>{runningId === task.id ? 'Running…' : 'Run now'}</button>
                {!completedOnce && <button className="ghost-button" type="button" disabled={disabled || busy || Boolean(runningId)} onClick={() => void toggle(task)}>{task.enabled ? 'Pause' : 'Resume'}</button>}
                <button className={`danger-button ${confirmRemoveId === task.id ? 'confirming' : ''}`} type="button" disabled={disabled || busy || Boolean(runningId)} onClick={() => void remove(task)}>{confirmRemoveId === task.id ? 'Confirm remove' : 'Remove'}</button>
              </div>
              </article>
            )
          })}
        </div>
      )}
    </div>
  )
}
