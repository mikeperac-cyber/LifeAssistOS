import type { PlanTask } from '../../../shared/types'
import { localDateFromTimestamp } from './life-dashboard-model'

export interface WeeklyCompletionDay {
  date: string
  label: string
  count: number
}

/** Build the seven-day completion history ending on the supplied local date. */
export function buildWeeklyCompletionSeries(
  tasks: readonly PlanTask[],
  today: string,
  timeZone: string
): WeeklyCompletionDay[] {
  const dates = Array.from({ length: 7 }, (_, index) => shiftCalendarDate(today, index - 6))
  const counts = new Map(dates.map((date) => [date, 0]))

  for (const task of tasks) {
    if (task.status !== 'done' || !task.completedAt) continue
    const date = localDateFromTimestamp(task.completedAt, timeZone)
    if (date === null || !counts.has(date)) continue
    counts.set(date, (counts.get(date) ?? 0) + 1)
  }

  return dates.map((date) => ({ date, label: weekdayLabel(date), count: counts.get(date) ?? 0 }))
}

function shiftCalendarDate(date: string, offset: number): string {
  const [year, month, day] = date.split('-').map(Number)
  const shifted = new Date(Date.UTC(year, month - 1, day + offset))
  return `${shifted.getUTCFullYear().toString().padStart(4, '0')}-${(shifted.getUTCMonth() + 1).toString().padStart(2, '0')}-${shifted.getUTCDate().toString().padStart(2, '0')}`
}

function weekdayLabel(date: string): string {
  const [year, month, day] = date.split('-').map(Number)
  return new Intl.DateTimeFormat('en', { weekday: 'short', timeZone: 'UTC' }).format(
    new Date(Date.UTC(year, month - 1, day))
  )
}
