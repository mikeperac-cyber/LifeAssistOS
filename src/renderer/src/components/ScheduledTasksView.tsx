import { useEffect, useState } from 'react'
import type { ChatMode, ScheduledAgentTask, ScheduledTaskSchedule } from '../../../shared/types'
import type { ScheduledTaskMutationResult, ScheduledTaskRunResult } from '../../../shared/ipc'

type ScheduleKind = ScheduledTaskSchedule['kind']

interface ScheduledTaskStarter {
  id: string
  name: string
  description: string
  prompt: string
  mode: ChatMode
  kind: ScheduleKind
  time: string
  weekday: number
}

export const SCHEDULED_TASK_STARTERS: ScheduledTaskStarter[] = [
  {
    id: 'morning-priorities',
    name: 'Morning priorities',
    description: 'Review open tasks and personal goals; suggest a realistic start.',
    prompt: 'Review my open tasks in Today and, if available, my Personal life coaching goals. Use only information you can retrieve. Recommend up to three priorities for today, briefly explain why, and mention any due dates. Do not change tasks, goals, or other saved data.',
    mode: 'coach_personal',
    kind: 'weekdays',
    time: '08:30',
    weekday: 1
  },
  {
    id: 'weekly-life-review',
    name: 'Weekly life review',
    description: 'Review current commitments and choose a few next steps.',
    prompt: 'Review my open tasks in Today and my Personal life coaching goals. Identify overdue or time-sensitive commitments supported by the saved data, then suggest up to three realistic priorities for the coming week. Separate known information from assumptions. Do not change any saved data.',
    mode: 'coach_personal',
    kind: 'weekly',
    time: '17:00',
    weekday: 0
  },
  {
    id: 'business-review',
    name: 'Business review',
    description: 'Check business goals, deadlines, and useful next actions.',
    prompt: 'Review my Business / LB English coaching goals and open tasks in Today. Summarize the current commitments, deadlines, and dependencies supported by the saved data, then suggest up to three next actions. Separate known information from assumptions. Do not update goals or tasks, and do not send anything.',
    mode: 'coach_business',
    kind: 'weekly',
    time: '09:00',
    weekday: 1
  },
  {
    id: 'study-session',
    name: 'Study session plan',
    description: 'Turn a saved study goal into one focused practice session.',
    prompt: 'Review my saved study tasks and goals, if any. Suggest one focused 25–45 minute study session with a clear learning objective, active recall or practice, a short break, and a quick self-check. If my subject or level is missing, ask me rather than guessing. Do not change saved data.',
    mode: 'coach_personal',
    kind: 'weekdays',
    time: '18:00',
    weekday: 1
  }
]

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
  searchTargetId,
  onSearchTargetConsumed,
  onCreate,
  onSetEnabled,
  onRemove,
  onRun
}: {
  tasks: ScheduledAgentTask[]
  disabled: boolean
  searchTargetId?: string | null
  onSearchTargetConsumed?: () => void
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

  useEffect(() => {
    if (!searchTargetId) return
    const frame = requestAnimationFrame(() => {
      const target = document.getElementById(`global-search-scheduled-${searchTargetId}`)
      target?.scrollIntoView({ behavior: 'smooth', block: 'center' })
      target?.focus({ preventScroll: true })
    })
    const timeout = window.setTimeout(() => onSearchTargetConsumed?.(), 4500)
    return () => { cancelAnimationFrame(frame); window.clearTimeout(timeout) }
  }, [searchTargetId, onSearchTargetConsumed])

  function applyStarter(starter: ScheduledTaskStarter): void {
    setName(starter.name)
    setPrompt(starter.prompt)
    setMode(starter.mode)
    setKind(starter.kind)
    setTime(starter.time)
    setWeekday(starter.weekday)
    setOnceAt('')
    setStatus('Template loaded. Review the instructions and schedule, then save when ready.')
  }

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
      const resultMessage = result.ok ? `“${task.name}” finished.` : result.error ?? 'The scheduled task did not finish.'
      setStatus(result.warning ? `${resultMessage} ${result.warning}` : resultMessage)
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
        <div className="scheduled-starters" role="group" aria-labelledby="scheduled-starters-label">
          <div className="scheduled-starters-head">
            <span id="scheduled-starters-label" className="field-label">Start from a routine</span>
            <span>Templates only fill this form. Nothing is scheduled until you save.</span>
          </div>
          <div className="scheduled-starters-list">
            {SCHEDULED_TASK_STARTERS.map((starter) => (
              <button key={starter.id} className="scheduled-starter" type="button" disabled={busy || disabled} onClick={() => applyStarter(starter)}>
                <strong>{starter.name}</strong>
                <span>{starter.description}</span>
              </button>
            ))}
          </div>
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
              <article
                id={`global-search-scheduled-${task.id}`}
                className={`scheduled-card ${searchTargetId === task.id ? 'is-global-search-target' : ''}`}
                key={task.id}
                tabIndex={searchTargetId === task.id ? -1 : undefined}
              >
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
