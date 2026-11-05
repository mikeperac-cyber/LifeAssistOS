import { useEffect, useRef, useState } from 'react'
import type { PlanTask, TaskExportProvider } from '../../../shared/types'
import type { TodayTaskExportActionResult } from '../../../shared/ipc'

export function TaskExportControl({
  provider,
  providerLabel,
  canWrite,
  taskListId,
  taskListTitle,
  tasks,
  disabled,
  onOpenSettings
}: {
  provider: TaskExportProvider
  providerLabel: string
  canWrite: boolean
  taskListId: string
  taskListTitle: string
  tasks: PlanTask[]
  disabled: boolean
  onOpenSettings: () => void
}): React.JSX.Element {
  const [taskId, setTaskId] = useState('')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const busyRef = useRef(false)

  useEffect(() => {
    if (tasks.some((task) => task.id === taskId)) return
    setTaskId(tasks[0]?.id ?? '')
  }, [tasks, taskId])

  useEffect(() => {
    setMessage('')
    setError('')
  }, [taskId, taskListId, provider])

  const task = tasks.find((item) => item.id === taskId)
  const exportRecord = task?.taskExports?.find((item) => item.provider === provider && item.taskListId === taskListId)
  const actionDisabled = disabled || busy || busyRef.current || !task || !taskListId || !taskListTitle

  const runAction = async (action: () => Promise<TodayTaskExportActionResult>, fallback: string): Promise<TodayTaskExportActionResult | null> => {
    if (busyRef.current) return null
    busyRef.current = true
    setBusy(true)
    setMessage('')
    setError('')
    try {
      const result = await action()
      if (!result.ok) throw new Error(result.error ?? fallback)
      return result
    } catch (cause) {
      setError(errorText(cause, fallback))
      return null
    } finally {
      busyRef.current = false
      setBusy(false)
    }
  }

  const send = async (): Promise<void> => {
    if (!task) return
    const result = await runAction(() => window.assist.exportTodayTask({
      provider,
      taskId: task.id,
      expectedUpdatedAt: task.updatedAt,
      taskListId,
      taskListTitle
    }), `Could not send this task to ${providerLabel}.`)
    if (!result) return
    const output = asRecord(result.output)
    if (output?.status === 'sent') setMessage(`Copied to ${providerLabel}. This is a one-time copy.`)
    else if (output?.status === 'already_sent') setMessage(`This task is already linked to ${providerLabel}.`)
    else if (output?.status === 'failed') setError(stringValue(output.error) ?? `${providerLabel} rejected the create request. You can approve a retry.`)
    else if (output?.status === 'not_sent') setError(stringValue(output.error) ?? 'The task was not sent.')
    else setMessage(`The ${providerLabel} action finished.`)
  }

  const clearRetryGuard = async (): Promise<void> => {
    if (!task) return
    const result = await runAction(() => window.assist.clearTodayTaskExportRetryGuard({
      provider,
      taskId: task.id,
      taskListId
    }), 'Could not clear the local retry guard.')
    if (result) setMessage('Local retry guard cleared. Send again only after checking the destination list.')
  }

  return (
    <div className="today-task-export-control">
      {!canWrite ? (
        <div className="today-task-export-guidance">
          <span>This connection is read-only. Reconnect in Settings to send tasks.</span>
          <button className="ghost-button" type="button" onClick={onOpenSettings} disabled={disabled}>Open Settings</button>
        </div>
      ) : !taskListId || !taskListTitle ? (
        <p className="muted">Load and choose a destination list before sending a local task.</p>
      ) : tasks.length === 0 ? (
        <p className="muted">No open local Today tasks are available to send.</p>
      ) : (
        <>
          <div className="today-task-export-actions">
            <label className="today-task-export-task-select">
              <span>Send a local task to <strong>{taskListTitle}</strong></span>
              <select value={taskId} onChange={(event) => setTaskId(event.target.value)} disabled={disabled || busy}>
                {tasks.map((item) => <option value={item.id} key={item.id}>{item.title}</option>)}
              </select>
            </label>
            {exportRecord?.status === 'sending' ? (
              <button className="ghost-button" type="button" disabled>Sending…</button>
            ) : exportRecord?.status === 'uncertain' ? (
              <button className="ghost-button" type="button" onClick={() => void clearRetryGuard()} disabled={actionDisabled}>
                I checked the list — clear retry guard
              </button>
            ) : exportRecord?.status === 'sent' ? (
              <button className="ghost-button" type="button" disabled>Already copied</button>
            ) : (
              <button className="primary-button" type="button" onClick={() => void send()} disabled={actionDisabled}>
                {busy ? 'Waiting for approval…' : exportRecord?.status === 'failed' ? 'Review retry' : 'Review send'}
              </button>
            )}
          </div>
          {exportRecord?.status === 'uncertain' && (
            <p className="today-task-export-warning">The provider may already have created this task. Check its list first. Clearing the guard requires a separate approval and may allow a duplicate.</p>
          )}
          <p className="today-task-export-help">Mike Assist shows the task title, notes, due date, and destination for approval before sending. Later edits will not sync.</p>
        </>
      )}
      {busy && <span className="sr-only" role="status">Waiting for approval and provider response.</span>}
      {message && <p className="status-success" role="status">{message}</p>}
      {error && <p className="status-error" role="alert">{error}</p>}
    </div>
  )
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' ? value as Record<string, unknown> : undefined
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value ? value : undefined
}

function errorText(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : typeof error === 'string' && error ? error : fallback
}
