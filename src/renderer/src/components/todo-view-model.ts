import type { PlanTask } from '../../../shared/types'

export type TaskListView = 'my-day' | 'today' | 'upcoming' | 'overdue' | 'due-week' | 'waiting' | 'all' | 'completed' | 'archived'

export interface TodoTaskGroup {
  task: PlanTask
  contextTitle?: string
  subtasks: PlanTask[]
}

export function filterTasksForView(tasks: PlanTask[], view: TaskListView, localDate: string): PlanTask[] {
  switch (view) {
    case 'my-day':
      return tasks.filter((task) => task.status === 'open' && task.plannedDate === localDate).sort((a, b) => (a.dayOrder ?? 0) - (b.dayOrder ?? 0))
    case 'today':
      return tasks.filter((task) => task.status === 'open' && (task.dueDate !== null ? task.dueDate <= localDate : !task.plannedDate || task.plannedDate <= localDate))
    case 'upcoming':
      return tasks.filter((task) => task.status === 'open' && task.dueDate !== null && task.dueDate > localDate)
    case 'overdue':
      return tasks.filter((task) => task.status === 'open' && task.dueDate !== null && task.dueDate < localDate)
    case 'due-week': {
      const horizonEnd = addCalendarDays(localDate, 6)
      return tasks.filter((task) => task.status === 'open' && task.dueDate !== null && task.dueDate >= localDate && task.dueDate <= horizonEnd)
    }
    case 'waiting':
      return tasks.filter((task) => task.status === 'open' && task.workflowStage === 'waiting')
    case 'all':
      return tasks.filter((task) => task.status === 'open')
    case 'completed':
      return tasks.filter((task) => task.status === 'done')
    case 'archived':
      return tasks.filter((task) => task.status === 'cancelled')
  }
}

function addCalendarDays(date: string, amount: number): string {
  const [year, month, day] = date.split('-').map(Number)
  const shifted = new Date(Date.UTC(year!, month! - 1, day! + amount))
  return `${shifted.getUTCFullYear()}-${String(shifted.getUTCMonth() + 1).padStart(2, '0')}-${String(shifted.getUTCDate()).padStart(2, '0')}`
}

export function filterTasksByQuery(tasks: PlanTask[], query: string): PlanTask[] {
  const terms = normalizeTaskSearch(query).split(' ').filter(Boolean)
  if (!terms.length) return tasks
  return tasks.filter((task) => {
    const content = normalizeTaskSearch(`${task.title} ${task.notes}`)
    return terms.every((term) => content.includes(term))
  })
}

export function groupTasksForView(tasks: PlanTask[], allTasks: PlanTask[]): TodoTaskGroup[] {
  const taskById = new Map(allTasks.map((task) => [task.id, task]))
  const visibleRootGroups = new Map<string, TodoTaskGroup>()
  const groups: TodoTaskGroup[] = []

  for (const task of tasks) {
    if (task.parentTaskId !== null) continue
    const group = { task, subtasks: [] as PlanTask[] }
    visibleRootGroups.set(task.id, group)
    groups.push(group)
  }

  for (const task of tasks) {
    if (task.parentTaskId === null) continue
    const parentGroup = visibleRootGroups.get(task.parentTaskId)
    if (parentGroup) {
      parentGroup.subtasks.push(task)
      continue
    }
    const parent = taskById.get(task.parentTaskId)
    groups.push({ task, contextTitle: parent?.title, subtasks: [] })
  }

  return groups
}

function normalizeTaskSearch(value: string): string {
  return value.normalize('NFKC').toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim()
}
