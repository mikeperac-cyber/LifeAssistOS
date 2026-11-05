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
  const [remoteConflict, setRemoteConflict] = useState<{ title: string; notes: string; dueDate: string | null; priority?: string; status?: string } | null>(null)
  const busyRef = useRef(false)

  useEffect(() => {
    if (tasks.some((task) => task.id === taskId)) return
    setTaskId(tasks[0]?.id ?? '')
  }, [tasks, taskId])

  useEffect(() => {
    setMessage('')
    setError('')
    setRemoteConflict(null)
  }, [taskId, taskListId, provider])

  const task = tasks.find((item) => item.id === taskId)
  const exportRecord = task?.taskExports?.find((item) => item.provider === provider && item.taskListId === taskListId)
  const actionDisabled = disabled || busy || busyRef.current || !task || !taskListId || !taskListTitle
  const hasLocalEditsSinceSend = Boolean(exportRecord?.status === 'sent' && task && taskDiffersFromBaseline(task, exportRecord, provider))
  const canSafelyUpdateLink = Boolean(exportRecord?.status === 'sent' && exportRecord.syncedLocalUpdatedAt && exportRecord.remoteEtag && (provider !== 'microsoft_todo' || exportRecord.syncedPriority !== undefined))

  const runAction = async (action: () => Promise<TodayTaskExportActionResult>, fallback: string): Promise<TodayTaskExportActionResult | null> => {
    if (busyRef.current) return null
    busyRef.current = true
    setBusy(true)
    setMessage('')
    setError('')
    setRemoteConflict(null)
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
    if (output?.status === 'sent') setMessage(`Copied to ${providerLabel}. Later edits can be sent with a separate approved update.`)
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

  const sync = async (): Promise<void> => {
    if (!task) return
    const result = await runAction(() => window.assist.syncTodayTask({
      provider,
      taskId: task.id,
      expectedUpdatedAt: task.updatedAt,
      taskListId,
      taskListTitle
    }), `Could not update the linked ${providerLabel} task.`)
    if (!result) return
    const output = asRecord(result.output)
    if (output?.status === 'synced') setMessage(output.alreadyApplied === true ? `The linked ${providerLabel} task already matches.` : `Updated the linked ${providerLabel} task.`)
    else if (output?.status === 'conflict') {
      const remoteTask = asRecord(output.remoteTask)
      if (remoteTask && typeof remoteTask.title === 'string') {
        setRemoteConflict({
          title: remoteTask.title,
          notes: typeof remoteTask.notes === 'string' ? remoteTask.notes : '',
          dueDate: typeof remoteTask.dueDate === 'string' ? remoteTask.dueDate : null,
          ...(typeof remoteTask.priority === 'string' ? { priority: remoteTask.priority } : {}),
          ...(typeof remoteTask.status === 'string' ? { status: remoteTask.status } : {})
        })
      }
      setError(stringValue(output.error) ?? `The linked ${providerLabel} task changed. Review it before syncing again.`)
    }
    else if (output?.status === 'uncertain') setError(stringValue(output.error) ?? `The ${providerLabel} update may have applied. Check the destination before retrying.`)
    else setError(stringValue(output?.error) ?? `Could not update the linked ${providerLabel} task.`)
  }

  const clearSyncRetryGuard = async (): Promise<void> => {
    if (!task) return
    const result = await runAction(() => window.assist.clearTodayTaskSyncRetryGuard({
      provider,
      taskId: task.id,
      taskListId
    }), 'Could not clear the local sync retry guard.')
    if (result) setMessage('Local sync retry guard cleared. The next update still checks the remote version before writing.')
  }

  return (
    <div className="today-task-export-control">
      {!canWrite ? (
        <div className="today-task-export-guidance">
          <span>This connection is read-only. Reconnect in Settings to send or update linked tasks.</span>
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
              exportRecord.syncStatus === 'sending' ? (
                <button className="ghost-button" type="button" disabled>Updating…</button>
              ) : exportRecord.syncStatus === 'uncertain' ? (
                <button className="ghost-button" type="button" onClick={() => void clearSyncRetryGuard()} disabled={actionDisabled}>
                  I checked the task — clear sync retry guard
                </button>
              ) : exportRecord.syncStatus === 'failed' && !hasLocalEditsSinceSend ? (
                <button className="ghost-button" type="button" disabled title="The linked provider task needs review before another update.">Remote task needs review</button>
              ) : !canSafelyUpdateLink ? (
                <button className="ghost-button" type="button" disabled title="This saved link has no complete version baseline, so Mike Assist cannot update it safely.">Version unavailable — update off</button>
              ) : hasLocalEditsSinceSend && canSafelyUpdateLink ? (
                <button className="primary-button" type="button" onClick={() => void sync()} disabled={actionDisabled}>
                  {busy ? 'Waiting for approval…' : 'Review update'}
                </button>
              ) : (
                <button className="ghost-button" type="button" disabled>Up to date</button>
              )
            ) : (
              <button className="primary-button" type="button" onClick={() => void send()} disabled={actionDisabled}>
                {busy ? 'Waiting for approval…' : exportRecord?.status === 'failed' ? 'Review retry' : 'Review send'}
              </button>
            )}
          </div>
          {exportRecord?.status === 'uncertain' && (
            <p className="today-task-export-warning">The provider may already have created this task. Check its list first. Clearing the guard requires a separate approval and may allow a duplicate.</p>
          )}
          {exportRecord?.status === 'sent' && exportRecord.syncStatus === 'uncertain' && (
            <p className="today-task-export-warning">The provider may already have applied the update. Check the linked task first. Clearing the local guard requires separate approval; the next update still checks the saved version.</p>
          )}
          {remoteConflict && (
            <details className="today-task-export-conflict" open>
              <summary>Current {providerLabel} version</summary>
              <dl>
                <dt>Title</dt><dd>{remoteConflict.title}</dd>
                <dt>Notes</dt><dd>{remoteConflict.notes || '(none)'}</dd>
                <dt>Due date</dt><dd>{remoteConflict.dueDate ?? '(none)'}</dd>
                {remoteConflict.priority && <><dt>Priority</dt><dd>{remoteConflict.priority}</dd></>}
                {remoteConflict.status && <><dt>Status</dt><dd>{remoteConflict.status}</dd></>}
              </dl>
            </details>
          )}
          <p className="today-task-export-help">Mike Assist previews each create or update for approval. Updates apply only to an existing linked task and stop if the provider copy changed.</p>
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

function taskDiffersFromBaseline(task: PlanTask, baseline: NonNullable<PlanTask['taskExports']>[number], provider: TaskExportProvider): boolean {
  if (!baseline.syncedLocalUpdatedAt || baseline.syncedTitle === undefined || baseline.syncedNotes === undefined) return false
  const titleLimit = provider === 'google_tasks' ? 1_024 : 240
  const title = task.title.replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, titleLimit)
  const notes = task.notes.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, ' ').trim().slice(0, 4_000)
  return title !== baseline.syncedTitle || notes !== baseline.syncedNotes || task.dueDate !== (baseline.syncedDueDate ?? null) ||
    (provider === 'microsoft_todo' && baseline.syncedPriority !== undefined && task.priority !== baseline.syncedPriority)
}
