import type { PlanTask } from '../../../shared/types'

export type TaskListView = 'today' | 'upcoming' | 'completed' | 'archived'

export interface TodoTaskGroup {
  task: PlanTask
  contextTitle?: string
  subtasks: PlanTask[]
}

export function filterTasksForView(tasks: PlanTask[], view: TaskListView, localDate: string): PlanTask[] {
  switch (view) {
    case 'today':
      return tasks.filter((task) => task.status === 'open' && (task.dueDate === null || task.dueDate <= localDate))
    case 'upcoming':
      return tasks.filter((task) => task.status === 'open' && task.dueDate !== null && task.dueDate > localDate)
    case 'completed':
      return tasks.filter((task) => task.status === 'done')
    case 'archived':
      return tasks.filter((task) => task.status === 'cancelled')
  }
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
