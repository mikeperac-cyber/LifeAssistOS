import type { PlanTask } from '../../../shared/types'
import type { TodoTaskGroup } from './todo-view-model'

export function TodoTaskRow({
  group,
  localDate,
  onToggleComplete,
  onArchive,
  onEdit,
  onAddSubtask
}: {
  group: TodoTaskGroup
  localDate: string
  onToggleComplete: (task: PlanTask) => void
  onArchive: (task: PlanTask) => void
  onEdit: (task: PlanTask) => void
  onAddSubtask: (task: PlanTask) => void
}): React.JSX.Element {
  return (
    <article className="todo-task-group">
      <TaskLine task={group.task} contextTitle={group.contextTitle} localDate={localDate} onToggleComplete={onToggleComplete} onArchive={onArchive} onEdit={onEdit} onAddSubtask={onAddSubtask} />
      {group.subtasks.length > 0 && (
        <div className="todo-subtasks" aria-label={`Subtasks of ${group.task.title}`}>
          {group.subtasks.map((task) => (
            <TaskLine key={task.id} task={task} localDate={localDate} isSubtask onToggleComplete={onToggleComplete} onArchive={onArchive} onEdit={onEdit} onAddSubtask={onAddSubtask} />
          ))}
        </div>
      )}
    </article>
  )
}

function TaskLine({
  task,
  contextTitle,
  localDate,
  isSubtask = false,
  onToggleComplete,
  onArchive,
  onEdit,
  onAddSubtask
}: {
  task: PlanTask
  contextTitle?: string
  localDate: string
  isSubtask?: boolean
  onToggleComplete: (task: PlanTask) => void
  onArchive: (task: PlanTask) => void
  onEdit: (task: PlanTask) => void
  onAddSubtask: (task: PlanTask) => void
}): React.JSX.Element {
  const overdue = task.status === 'open' && task.dueDate !== null && task.dueDate < localDate
  return (
    <div className={`todo-task-row ${isSubtask ? 'is-subtask' : ''} ${task.status === 'done' ? 'is-complete' : ''} ${task.status === 'cancelled' ? 'is-archived' : ''}`}>
      {task.status !== 'cancelled' ? (
        <button
          className={`todo-task-check ${task.status === 'done' ? 'checked' : ''}`}
          type="button"
          aria-label={task.status === 'done' ? `Reopen ${task.title}` : `Complete ${task.title}`}
          title={task.status === 'done' ? 'Reopen task' : 'Complete task'}
          onClick={() => onToggleComplete(task)}
        >
          {task.status === 'done' ? '✓' : ''}
        </button>
      ) : <span className="todo-task-check archived-check" aria-hidden="true">–</span>}

      <div className="todo-task-main">
        {contextTitle && <span className="todo-task-context">Subtask of {contextTitle}</span>}
        <button className="todo-task-title" type="button" onClick={() => onEdit(task)}>{task.title}</button>
        {task.notes && <p className="todo-task-notes">{task.notes}</p>}
        <div className="todo-task-meta">
          {task.dueDate && <span className={`todo-task-date ${overdue ? 'is-overdue' : ''}`}>{overdue ? 'Overdue · ' : 'Due · '}{formatDate(task.dueDate)}</span>}
          {task.priority !== 'normal' && <span className={`todo-task-priority priority-${task.priority}`}>{task.priority}</span>}
          {task.remindAt && <span className="todo-task-reminder">Reminder set</span>}
        </div>
      </div>

      <div className="todo-task-actions">
        {task.parentTaskId === null && task.status === 'open' && (
          <button className="todo-row-action" type="button" onClick={() => onAddSubtask(task)} aria-label={`Add subtask to ${task.title}`}>＋ Step</button>
        )}
        <button className="todo-row-action" type="button" onClick={() => onEdit(task)} aria-label={`Edit ${task.title}`}>Edit</button>
        <button className="todo-row-action" type="button" onClick={() => onArchive(task)} aria-label={task.status === 'cancelled' ? `Restore ${task.title}` : `Archive ${task.title}`}>
          {task.status === 'cancelled' ? 'Restore' : 'Archive'}
        </button>
      </div>
    </div>
  )
}

function formatDate(value: string): string {
  const [year, month, day] = value.split('-').map(Number)
  return new Date(year, month - 1, day).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}
