import type { PlanTask, PlanTaskPriority, TaskWorkflowStage } from '../../../shared/types'
import { filterTasksForView, type TaskListView } from './todo-view-model'

export const SAVED_TASK_VIEWS_KEY = 'mike-assist-saved-task-views'
export const MAX_SAVED_TASK_VIEWS = 12

export type SavedTaskDateFilter = 'any' | 'today' | 'overdue' | 'next-7-days' | 'no-date'

export interface SavedTaskView {
  id: string
  name: string
  baseView: TaskListView
  projectId: string | null
  priority: PlanTaskPriority | null
  workflowStage: TaskWorkflowStage | null
  dueDate: SavedTaskDateFilter
}

export type SavedTaskFilters = Pick<SavedTaskView, 'projectId' | 'priority' | 'workflowStage' | 'dueDate'>

export const EMPTY_SAVED_TASK_FILTER: SavedTaskFilters = {
  projectId: null,
  priority: null,
  workflowStage: null,
  dueDate: 'any' as SavedTaskDateFilter
}

const BASE_VIEWS = new Set<TaskListView>(['my-day', 'today', 'upcoming', 'overdue', 'due-week', 'waiting', 'all', 'completed', 'archived'])
const PRIORITIES = new Set<PlanTaskPriority>(['low', 'normal', 'high'])
const STAGES = new Set<TaskWorkflowStage>(['next', 'in-progress', 'waiting'])
const DATE_FILTERS = new Set<SavedTaskDateFilter>(['any', 'today', 'overdue', 'next-7-days', 'no-date'])

export function readSavedTaskViews(read: (key: string) => string | null = (key) => window.localStorage.getItem(key)): SavedTaskView[] {
  try {
    const raw = read(SAVED_TASK_VIEWS_KEY)
    return raw ? parseSavedTaskViews(JSON.parse(raw)) : []
  } catch { return [] }
}

export function parseSavedTaskViews(value: unknown): SavedTaskView[] {
  if (!Array.isArray(value)) return []
  const seenIds = new Set<string>()
  const views: SavedTaskView[] = []
  for (const item of value) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) continue
    const input = item as Record<string, unknown>
    if (typeof input.id !== 'string' || !/^[\w-]{1,80}$/.test(input.id) || seenIds.has(input.id) ||
      typeof input.name !== 'string' || !input.name.trim() || input.name.trim().length > 40 ||
      typeof input.baseView !== 'string' || !BASE_VIEWS.has(input.baseView as TaskListView) ||
      (input.projectId !== null && (typeof input.projectId !== 'string' || input.projectId.length > 80)) ||
      (input.priority !== null && (typeof input.priority !== 'string' || !PRIORITIES.has(input.priority as PlanTaskPriority))) ||
      (input.workflowStage !== null && (typeof input.workflowStage !== 'string' || !STAGES.has(input.workflowStage as TaskWorkflowStage))) ||
      typeof input.dueDate !== 'string' || !DATE_FILTERS.has(input.dueDate as SavedTaskDateFilter)) continue
    seenIds.add(input.id)
    views.push({
      id: input.id,
      name: input.name.trim(),
      baseView: input.baseView as TaskListView,
      projectId: input.projectId as string | null,
      priority: input.priority as PlanTaskPriority | null,
      workflowStage: input.workflowStage as TaskWorkflowStage | null,
      dueDate: input.dueDate as SavedTaskDateFilter
    })
    if (views.length >= MAX_SAVED_TASK_VIEWS) break
  }
  return views
}

export function filterTasksForSavedView(tasks: PlanTask[], view: SavedTaskView, localDate: string): PlanTask[] {
  const horizonEnd = addCalendarDays(localDate, 6)
  return filterTasksForView(tasks, view.baseView, localDate).filter((task) => {
    if (view.projectId !== null && task.projectId !== view.projectId) return false
    if (view.priority !== null && task.priority !== view.priority) return false
    if (view.workflowStage !== null && (task.workflowStage ?? 'next') !== view.workflowStage) return false
    switch (view.dueDate) {
      case 'today': return task.dueDate === localDate
      case 'overdue': return task.dueDate !== null && task.dueDate < localDate
      case 'next-7-days': return task.dueDate !== null && task.dueDate >= localDate && task.dueDate <= horizonEnd
      case 'no-date': return task.dueDate === null
      case 'any': return true
    }
  })
}

function addCalendarDays(date: string, amount: number): string {
  const [year, month, day] = date.split('-').map(Number)
  const shifted = new Date(Date.UTC(year!, month! - 1, day! + amount))
  return `${shifted.getUTCFullYear()}-${String(shifted.getUTCMonth() + 1).padStart(2, '0')}-${String(shifted.getUTCDate()).padStart(2, '0')}`
}
