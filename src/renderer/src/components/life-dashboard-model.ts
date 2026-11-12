import type { CalendarEvent, PlanTask, TaskProject } from '../../../shared/types'
import { addDays } from './review-view-model'

export interface DashboardSummary {
  plannedTasks: PlanTask[]
  focusTasks: PlanTask[]
  dueTodayCount: number
  completedTodayCount: number
  todayEventCount: number
  projectCards: Array<{ project: TaskProject; openTaskCount: number; nextTask: PlanTask }>
  upcomingTasks: PlanTask[]
  upcomingEvents: CalendarEvent[]
}

export function localDateFromTimestamp(value: string, timeZone: string): string | null {
  return localDateFormatter(timeZone)(value)
}

export function getGoalProgress(goalId: string, projects: readonly TaskProject[], tasks: readonly PlanTask[]): {
  projectCount: number
  completed: number
  open: number
  total: number
  percent: number
} {
  const projectIds = new Set(projects.filter((project) => project.goalId === goalId).map((project) => project.id))
  const linkedTasks = tasks.filter((task) => task.projectId && projectIds.has(task.projectId))
  const completed = linkedTasks.filter((task) => task.status === 'done').length
  const open = linkedTasks.filter((task) => task.status === 'open').length
  const total = completed + open
  return { projectCount: projectIds.size, completed, open, total, percent: total ? Math.round(completed / total * 100) : 0 }
}

export function buildDashboardSummary(input: {
  tasks: readonly PlanTask[]
  projects: readonly TaskProject[]
  todayEvents: readonly CalendarEvent[]
  upcomingEvents: readonly CalendarEvent[]
  today: string
  timeZone: string
}): DashboardSummary {
  const { tasks, projects, todayEvents, upcomingEvents, today, timeZone } = input
  const horizonEnd = addDays(today, 6)
  const localDate = localDateFormatter(timeZone)
  const openTasks = tasks.filter((task) => task.status === 'open')
  const plannedTasks = openTasks.filter((task) => task.plannedDate === today).sort((a, b) =>
    (a.dayOrder ?? 0) - (b.dayOrder ?? 0) || compareCreation(a, b)
  )

  const tasksByProject = new Map<string, PlanTask[]>()
  for (const task of openTasks) {
    if (!task.projectId) continue
    const projectTasks = tasksByProject.get(task.projectId) ?? []
    projectTasks.push(task)
    tasksByProject.set(task.projectId, projectTasks)
  }
  const projectCards = projects.flatMap((project) => {
    const projectTasks = tasksByProject.get(project.id)
    const nextTask = projectTasks?.sort(compareProjectTasks)[0]
    return projectTasks && nextTask ? [{ project, openTaskCount: projectTasks.length, nextTask }] : []
  })

  return {
    plannedTasks,
    focusTasks: plannedTasks.slice(0, 3),
    dueTodayCount: openTasks.filter((task) => task.dueDate === today).length,
    completedTodayCount: tasks.filter((task) =>
      task.status === 'done' && task.completedAt && localDate(task.completedAt) === today
    ).length,
    todayEventCount: todayEvents.length,
    projectCards,
    upcomingTasks: openTasks
      .filter((task) => task.dueDate !== null && task.dueDate >= today && task.dueDate <= horizonEnd)
      .sort((a, b) => (a.dueDate ?? '').localeCompare(b.dueDate ?? '') || compareProjectTasks(a, b)),
    upcomingEvents: calendarEventsInRange(upcomingEvents, today, horizonEnd, timeZone)
      .sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt) || a.title.localeCompare(b.title))
  }
}

export function calendarEventsInRange(events: readonly CalendarEvent[], firstDay: string, lastDay: string, timeZone: string): CalendarEvent[] {
  const localDate = localDateFormatter(timeZone)
  const utcDate = localDateFormatter('UTC')
  return events.filter((event) => {
    // All-day dates are stored as UTC midnight. iCalendar event ends are exclusive.
    const formatDate = event.allDay ? utcDate : localDate
    const startTime = Date.parse(event.startsAt)
    const endTime = Date.parse(event.endsAt)
    if (!(endTime > startTime)) return false
    const start = formatDate(startTime)
    const end = formatDate(endTime - 1)
    return start !== null && end !== null && start <= lastDay && end >= firstDay
  })
}

function localDateFormatter(timeZone: string): (value: string | number) => string | null {
  let formatter: Intl.DateTimeFormat
  try {
    formatter = new Intl.DateTimeFormat('en', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' })
  } catch {
    return () => null
  }
  return (value) => {
    const timestamp = typeof value === 'number' ? value : Date.parse(value)
    if (!Number.isFinite(timestamp)) return null
    const parts = formatter.formatToParts(timestamp)
    const year = parts.find((part) => part.type === 'year')?.value.padStart(4, '0')
    const month = parts.find((part) => part.type === 'month')?.value
    const day = parts.find((part) => part.type === 'day')?.value
    return year && month && day ? `${year}-${month}-${day}` : null
  }
}

function compareProjectTasks(a: PlanTask, b: PlanTask): number {
  const highPriorityFirst = Number(b.priority === 'high') - Number(a.priority === 'high')
  const datedFirst = Number(a.dueDate === null) - Number(b.dueDate === null)
  return highPriorityFirst || datedFirst || (a.dueDate ?? '').localeCompare(b.dueDate ?? '') || compareCreation(a, b)
}

function compareCreation(a: PlanTask, b: PlanTask): number {
  return a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id)
}
