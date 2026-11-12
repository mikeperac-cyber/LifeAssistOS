import type { PlanTask } from '../../../shared/types'
import type { TodoTaskGroup } from './todo-view-model'

export function TodoTaskRow({
  group,
  localDate,
  onToggleComplete,
  onArchive,
  onEdit,
  onAddSubtask,
  onPlanForToday,
  onClearPlan,
  onSkipOccurrence,
  moveEarlier,
  moveLater
}: {
  group: TodoTaskGroup
  localDate: string
  onToggleComplete: (task: PlanTask) => void
  onArchive: (task: PlanTask) => void
  onEdit: (task: PlanTask) => void
  onAddSubtask: (task: PlanTask) => void
  onPlanForToday: (task: PlanTask) => void
  onClearPlan: (task: PlanTask) => void
  onSkipOccurrence: (task: PlanTask) => void
  moveEarlier?: () => void
  moveLater?: () => void
}): React.JSX.Element {
  return (
    <article className="todo-task-group">
      <div className="todo-task-with-order">
        {(moveEarlier || moveLater) && <div className="todo-task-order">{moveEarlier && <button type="button" className="todo-row-action" onClick={moveEarlier} aria-label={`Move ${group.task.title} earlier in My Day`}>↑</button>}{moveLater && <button type="button" className="todo-row-action" onClick={moveLater} aria-label={`Move ${group.task.title} later in My Day`}>↓</button>}</div>}
        <TaskLine task={group.task} contextTitle={group.contextTitle} localDate={localDate} onToggleComplete={onToggleComplete} onArchive={onArchive} onEdit={onEdit} onAddSubtask={onAddSubtask} onPlanForToday={onPlanForToday} onClearPlan={onClearPlan} onSkipOccurrence={onSkipOccurrence} />
      </div>
      {group.subtasks.length > 0 && (
        <div className="todo-subtasks" aria-label={`Subtasks of ${group.task.title}`}>
          {group.subtasks.map((task) => (
          <TaskLine key={task.id} task={task} localDate={localDate} isSubtask onToggleComplete={onToggleComplete} onArchive={onArchive} onEdit={onEdit} onAddSubtask={onAddSubtask} onPlanForToday={onPlanForToday} onClearPlan={onClearPlan} onSkipOccurrence={onSkipOccurrence} />
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
  onAddSubtask,
  onPlanForToday,
  onClearPlan,
  onSkipOccurrence
}: {
  task: PlanTask
  contextTitle?: string
  localDate: string
  isSubtask?: boolean
  onToggleComplete: (task: PlanTask) => void
  onArchive: (task: PlanTask) => void
  onEdit: (task: PlanTask) => void
  onAddSubtask: (task: PlanTask) => void
  onPlanForToday: (task: PlanTask) => void
  onClearPlan: (task: PlanTask) => void
  onSkipOccurrence: (task: PlanTask) => void
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
          {task.plannedDate && task.plannedDate !== localDate && <span className="todo-task-date">Planned · {formatDate(task.plannedDate)}</span>}
          {task.priority !== 'normal' && <span className={`todo-task-priority priority-${task.priority}`}>{task.priority}</span>}
          {task.remindAt && <span className="todo-task-reminder">Reminder set</span>}
          {task.recurrenceRule && <span className="todo-task-repeat">{formatRecurrence(task.recurrenceRule)}</span>}
        </div>
      </div>

      <div className="todo-task-actions">
        {task.status === 'open' && <button className="todo-row-action" type="button" onClick={() => onPlanForToday(task)} aria-label={task.plannedDate === localDate ? `Remove ${task.title} from My Day` : `Add ${task.title} to My Day`}>{task.plannedDate === localDate ? 'Remove from My Day' : task.plannedDate ? 'Move to My Day' : '＋ My Day'}</button>}
        {task.status === 'open' && task.recurrenceRule && <button className="todo-row-action" type="button" onClick={() => onSkipOccurrence(task)} aria-label={`Skip this occurrence of ${task.title}`}>Skip once</button>}
        {task.status === 'open' && task.plannedDate && task.plannedDate !== localDate && <button className="todo-row-action" type="button" onClick={() => onClearPlan(task)}>Clear plan</button>}
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

function formatRecurrence(rule: NonNullable<PlanTask['recurrenceRule']>): string {
  const frequency = rule.frequency === 'daily' ? 'Repeats daily' : rule.frequency === 'monthly' ? `Repeats monthly on day ${rule.monthDay}` : `Repeats ${rule.weekdays?.map((day) => ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][day]).join(', ')}`
  return rule.endsOn ? `${frequency} · through ${formatDate(rule.endsOn)}` : frequency
}
