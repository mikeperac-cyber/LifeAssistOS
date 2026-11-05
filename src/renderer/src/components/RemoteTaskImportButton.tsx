import { useState } from 'react'
import type { GoogleTask, MicrosoftTodoTask, PlanTask, RemoteTaskProvider, TodaySnapshot } from '../../../shared/types'

export function RemoteTaskImportButton({ provider, taskListId, task, alreadyImported, disabled, onSnapshot }: {
  provider: RemoteTaskProvider
  taskListId: string
  task: GoogleTask | MicrosoftTodoTask
  alreadyImported: boolean
  disabled: boolean
  onSnapshot: (snapshot: TodaySnapshot) => void
}): React.JSX.Element {
  const [busy, setBusy] = useState(false)
  const [copyResult, setCopyResult] = useState<'created' | 'duplicate' | null>(null)
  const [error, setError] = useState('')
  const isCompleted = task.status === 'completed'
  const isImported = alreadyImported || copyResult !== null
  const textWasShortened = task.title.length > 240 || (task.notes?.length ?? 0) > 2000 || task.notesTruncated === true

  const copyTask = async (): Promise<void> => {
    if (busy || isImported || isCompleted) return
    setBusy(true)
    setError('')
    try {
      const result = await window.assist.importPlanTask({
        provider,
        taskListId,
        taskId: task.id,
        title: task.title,
        notes: task.notes,
        dueDate: task.due?.slice(0, 10) ?? null,
        priority: 'priority' in task ? task.priority : undefined,
        status: task.status
      })
      if (!result.ok || !result.snapshot) throw new Error(result.error ?? 'Could not copy this task into Today.')
      onSnapshot(result.snapshot)
      setCopyResult(result.created ? 'created' : 'duplicate')
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : typeof cause === 'string' ? cause : 'Could not copy this task into Today.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="today-google-task-actions">
      <span className="today-google-task-status">{formatRemoteTaskStatus(task.status)}</span>
      <button className="ghost-button" type="button" onClick={() => void copyTask()} disabled={disabled || busy || isImported || isCompleted}>
        {busy ? 'Copying…' : alreadyImported ? 'In Today' : copyResult === 'created' ? 'Copied' : copyResult === 'duplicate' ? 'Already copied' : isCompleted ? 'Completed' : 'Copy to Today'}
      </button>
      {copyResult === 'created' && <span className="today-google-task-import-status" role="status">{textWasShortened ? 'Copied. Long text was shortened to fit local task limits.' : 'Copied to local Today.'}</span>}
      {copyResult === 'duplicate' && <span className="today-google-task-import-status" role="status">A local copy already exists; no duplicate was added.</span>}
      {error && <span className="today-google-task-import-error" role="alert">{error}</span>}
    </div>
  )
}

function formatRemoteTaskStatus(status: GoogleTask['status'] | MicrosoftTodoTask['status']): string {
  switch (status) {
    case 'completed': return 'Completed'
    case 'inProgress': return 'In progress'
    case 'waitingOnOthers': return 'Waiting on others'
    case 'deferred': return 'Deferred'
    default: return 'Open'
  }
}

export function isRemoteTaskImported(tasks: readonly PlanTask[], provider: RemoteTaskProvider, taskListId: string, taskId: string): boolean {
  return tasks.some((task) => task.remoteTaskSource?.provider === provider && task.remoteTaskSource.taskListId === taskListId && task.remoteTaskSource.taskId === taskId)
}
