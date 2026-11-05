import type { CalendarPrepTaskInput } from './ipc'

export function isCalendarPrepTaskInput(value: unknown): value is CalendarPrepTaskInput {
  if (!value || typeof value !== 'object') return false
  const input = value as Partial<CalendarPrepTaskInput>
  const validDateOnly = (date: unknown): date is string => {
    if (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return false
    const time = Date.parse(`${date}T00:00:00.000Z`)
    return Number.isFinite(time) && new Date(time).toISOString().slice(0, 10) === date
  }
  const validDateTime = (date: unknown): date is string => {
    if (typeof date !== 'string') return false
    const match = date.match(/^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(?:Z|([+-])(\d{2}):(\d{2}))$/i)
    return Boolean(match && validDateOnly(match[1]) && Number(match[2]) <= 23 && Number(match[3]) <= 59 && Number(match[4]) <= 59 &&
      (match[6] === undefined || (Number(match[6]) <= 23 && Number(match[7]) <= 59)) && Number.isFinite(Date.parse(date)))
  }
  const validTimeRange = (input.isAllDay === true && validDateOnly(input.start) && validDateOnly(input.end)) ||
    (validDateTime(input.start) && validDateTime(input.end))
  return (input.provider === 'google_calendar' || input.provider === 'microsoft_calendar') &&
    typeof input.eventId === 'string' && input.eventId.trim().length > 0 && input.eventId.length <= 1_024 && !/[\u0000-\u001f\u007f]/.test(input.eventId) &&
    typeof input.eventTitle === 'string' && input.eventTitle.trim().length > 0 && input.eventTitle.length <= 500 && !/[\u0000-\u001f\u007f]/.test(input.eventTitle) &&
    typeof input.isAllDay === 'boolean' && validTimeRange && Date.parse(input.end!) > Date.parse(input.start!) &&
    (input.location === undefined || (typeof input.location === 'string' && input.location.length <= 300 && !/[\u0000-\u001f\u007f]/.test(input.location)))
}
