import type { TaskRecurrenceInput, TaskRecurrenceRule } from '../shared/types'
import { assertDateOnly, isDateOnly } from '../shared/date-only'

export function normalizeRecurrenceRule(
  value: TaskRecurrenceInput,
  anchorDate: string,
  previousMonthDay?: number
): TaskRecurrenceRule {
  assertDateOnly(anchorDate, 'recurrence date')
  if (!value || !['daily', 'weekly', 'monthly'].includes(value.frequency)) {
    throw new Error('Choose a valid repeat frequency.')
  }
  if (value.endsOn !== undefined && value.endsOn !== null) {
    assertDateOnly(value.endsOn, 'repeat end date')
    if (value.endsOn < anchorDate) throw new Error('The repeat end date must be on or after the task due date.')
  }

  let weekdays: number[] | undefined
  if (value.frequency === 'weekly') {
    if (!Array.isArray(value.weekdays) || value.weekdays.length === 0 ||
      value.weekdays.some((day) => !Number.isInteger(day) || day < 0 || day > 6)) {
      throw new Error('Choose at least one valid weekday for a weekly repeat.')
    }
    weekdays = [...new Set(value.weekdays)].sort((a, b) => a - b)
  } else if (value.weekdays !== undefined) {
    throw new Error('Weekdays can only be set for a weekly repeat.')
  }

  const endsOn = value.endsOn ?? undefined
  if (value.frequency !== 'monthly') return { frequency: value.frequency, ...(weekdays ? { weekdays } : {}), ...(endsOn ? { endsOn } : {}) }
  const monthDay = previousMonthDay ?? Number(anchorDate.slice(8, 10))
  if (!Number.isInteger(monthDay) || monthDay < 1 || monthDay > 31) throw new Error('Choose a valid monthly day.')
  return { frequency: 'monthly', monthDay, ...(endsOn ? { endsOn } : {}) }
}

export function getNextRecurrenceDate(
  rule: TaskRecurrenceRule,
  afterDate: string,
  monthDay?: number
): string | null {
  assertDateOnly(afterDate, 'recurrence boundary')
  const endsOn = rule.endsOn ?? undefined
  if (endsOn) assertDateOnly(endsOn, 'repeat end date')
  if (rule.frequency === 'daily') {
    const candidate = addDays(afterDate, 1)
    return candidate && (!endsOn || candidate <= endsOn) ? candidate : null
  }
  if (rule.frequency === 'weekly') {
    if (!Array.isArray(rule.weekdays) || rule.weekdays.length === 0 || rule.weekdays.some((day) => !Number.isInteger(day) || day < 0 || day > 6)) {
      throw new Error('Choose at least one valid weekday for a weekly repeat.')
    }
    let cursor = afterDate
    for (let offset = 0; offset < 7; offset += 1) {
      const candidate = addDays(cursor, 1)
      if (!candidate) return null
      if (rule.weekdays.includes(weekday(candidate))) return !endsOn || candidate <= endsOn ? candidate : null
      cursor = candidate
    }
    return null
  }
  if (rule.frequency !== 'monthly') throw new Error('Choose a valid repeat frequency.')
  const stableDay = rule.monthDay ?? monthDay
  if (!Number.isInteger(stableDay) || stableDay! < 1 || stableDay! > 31) throw new Error('Choose a valid monthly day.')
  let [year, month] = afterDate.split('-').map(Number)
  for (let count = 0; count < 120_000 && year <= 9999; count += 1) {
    const day = Math.min(stableDay!, daysInMonth(year, month))
    const candidate = `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
    if (candidate > afterDate) return !endsOn || candidate <= endsOn ? candidate : null
    month += 1
    if (month === 13) { month = 1; year += 1 }
  }
  return null
}

function addDays(value: string, amount: number): string | null {
  const [year, month, day] = value.split('-').map(Number)
  const date = new Date(Date.UTC(year, month - 1, day + amount))
  const result = `${String(date.getUTCFullYear()).padStart(4, '0')}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-${String(date.getUTCDate()).padStart(2, '0')}`
  return isDateOnly(result) ? result : null
}

function weekday(value: string): number {
  const [year, month, day] = value.split('-').map(Number)
  return new Date(Date.UTC(year, month - 1, day)).getUTCDay()
}

function daysInMonth(year: number, month: number): number {
  const leapYear = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0)
  return [31, leapYear ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1] ?? 0
}
