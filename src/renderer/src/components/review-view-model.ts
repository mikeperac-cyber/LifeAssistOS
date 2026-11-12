import type { InboxItem, PlanTask, TaskArea, TaskProject } from '../../../shared/types'

export type ReviewTaskFilter = 'my-day' | 'inbox' | 'upcoming' | 'all' | 'overdue' | 'due-week' | 'waiting'

export interface ReviewProjectSummary {
  project: TaskProject
  areaName: string | null
  openCount: number
  waitingCount: number
  dueSoonCount: number
}

export interface CompletedWeek {
  start: string
  end: string
  label: string
  count: number
}

export interface ReviewViewModel {
  today: string
  horizonEnd: string
  weekStart: string
  inbox: InboxItem[]
  openCount: number
  overdue: PlanTask[]
  dueSoon: PlanTask[]
  unplannedDueSoon: PlanTask[]
  waiting: PlanTask[]
  completedThisWeek: number
  completedWeeks: CompletedWeek[]
  projects: ReviewProjectSummary[]
}

export function buildReviewViewModel(input: {
  today: string
  timeZone: string
  inbox: InboxItem[]
  tasks: PlanTask[]
  projects: TaskProject[]
  areas: TaskArea[]
}): ReviewViewModel {
  const horizonEnd = addDays(input.today, 6)
  const weekStart = startOfWeek(input.today)
  const open = input.tasks.filter((task) => task.status === 'open')
  const overdue = open.filter((task) => task.dueDate !== null && task.dueDate < input.today).sort(compareTasks)
  const dueSoon = open.filter((task) => task.dueDate !== null && task.dueDate >= input.today && task.dueDate <= horizonEnd).sort(compareTasks)
  const unplannedDueSoon = dueSoon.filter((task) => task.plannedDate === null || task.plannedDate === undefined || task.plannedDate < input.today || task.plannedDate > horizonEnd)
  const waiting = open.filter((task) => task.workflowStage === 'waiting').sort(compareTasks)
  const areaNames = new Map(input.areas.map((area) => [area.id, area.name]))
  const projectById = new Map(input.projects.map((project) => [project.id, project]))
  const projectTasks = new Map<string, PlanTask[]>()
  for (const task of open) {
    if (!task.projectId || !projectById.has(task.projectId)) continue
    const group = projectTasks.get(task.projectId) ?? []
    group.push(task)
    projectTasks.set(task.projectId, group)
  }
  const projects = input.projects.map((project) => {
    const tasksForProject = projectTasks.get(project.id) ?? []
    return {
      project,
      areaName: project.areaId ? areaNames.get(project.areaId) ?? null : null,
      openCount: tasksForProject.length,
      waitingCount: tasksForProject.filter((task) => task.workflowStage === 'waiting').length,
      dueSoonCount: tasksForProject.filter((task) => task.dueDate !== null && task.dueDate >= input.today && task.dueDate <= horizonEnd).length
    }
  }).filter((summary) => summary.openCount > 0)
    .sort((a, b) => b.waitingCount - a.waitingCount || b.dueSoonCount - a.dueSoonCount || b.openCount - a.openCount || a.project.name.localeCompare(b.project.name))

  const completedThisWeek = input.tasks.filter((task) => {
    if (task.status !== 'done' || !task.completedAt) return false
    const completedDate = localDateFromTimestamp(task.completedAt, input.timeZone)
    return completedDate !== null && completedDate >= weekStart && completedDate <= input.today
  }).length
  const completedWeeks = Array.from({ length: 4 }, (_, index) => {
    const offset = 4 - index
    const start = addDays(weekStart, -7 * offset)
    const end = addDays(start, 6)
    return { start, end, label: formatWeekLabel(start), count: 0 }
  }).map((week) => ({
    ...week,
    count: input.tasks.filter((task) => {
      if (task.status !== 'done' || !task.completedAt) return false
      const completedDate = localDateFromTimestamp(task.completedAt, input.timeZone)
      return completedDate !== null && completedDate >= week.start && completedDate <= week.end
    }).length
  }))

  return {
    today: input.today,
    horizonEnd,
    weekStart,
    inbox: [...input.inbox].sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    openCount: open.length,
    overdue,
    dueSoon,
    unplannedDueSoon,
    waiting,
    completedThisWeek,
    completedWeeks,
    projects
  }
}

export function addDays(date: string, amount: number): string {
  const [year, month, day] = date.split('-').map(Number)
  const result = new Date(Date.UTC(year!, month! - 1, day! + amount))
  return `${result.getUTCFullYear()}-${String(result.getUTCMonth() + 1).padStart(2, '0')}-${String(result.getUTCDate()).padStart(2, '0')}`
}

export function startOfWeek(date: string): string {
  const [year, month, day] = date.split('-').map(Number)
  const weekday = new Date(Date.UTC(year!, month! - 1, day!)).getUTCDay()
  return addDays(date, -((weekday + 6) % 7))
}

export function formatWeekLabel(start: string): string {
  const [year, month, day] = start.split('-').map(Number)
  return new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', timeZone: 'UTC' })
    .format(new Date(Date.UTC(year!, month! - 1, day!)))
}

function localDateFromTimestamp(value: string, timeZone: string): string | null {
  const timestamp = Date.parse(value)
  if (!Number.isFinite(timestamp)) return null
  try {
    const parts = new Intl.DateTimeFormat('en', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(timestamp)
    const part = (type: Intl.DateTimeFormatPartTypes): string => parts.find((entry) => entry.type === type)?.value ?? ''
    const result = `${part('year')}-${part('month')}-${part('day')}`
    return /^\d{4}-\d{2}-\d{2}$/.test(result) ? result : null
  } catch {
    return null
  }
}

function compareTasks(first: PlanTask, second: PlanTask): number {
  const priority = { high: 0, normal: 1, low: 2 }
  return (priority[first.priority] - priority[second.priority]) ||
    (first.dueDate ?? '9999-99-99').localeCompare(second.dueDate ?? '9999-99-99') ||
    first.createdAt.localeCompare(second.createdAt) || first.id.localeCompare(second.id)
}
