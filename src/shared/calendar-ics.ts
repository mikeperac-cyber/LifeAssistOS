import type { CalendarEventInput } from './types'

/** Parses the useful read-only event fields from a user-selected iCalendar export. */
export function parseCalendarIcs(source: string): CalendarEventInput[] {
  if (source.length > 5_000_000) throw new Error('This calendar file is larger than 5 MB.')
  const lines = source.replace(/\r?\n[ \t]/g, '').split(/\r?\n/)
  const events: CalendarEventInput[] = []
  let current: Record<string, { value: string; params: Record<string, string> }> | null = null
  for (const line of lines) {
    if (line === 'BEGIN:VEVENT') { current = {}; continue }
    if (line === 'END:VEVENT') {
      if (current) {
        const start = current['DTSTART']
        const end = current['DTEND']
        const title = current['SUMMARY']?.value
        if (start && end && title) {
          const startDate = parseIcsDate(start)
          const endDate = parseIcsDate(end)
          events.push({ externalUid: current['UID']?.value ?? null, title: unescapeText(title), startsAt: startDate.value, endsAt: endDate.value, allDay: startDate.allDay, location: unescapeText(current['LOCATION']?.value ?? '') })
        }
      }
      current = null
      continue
    }
    if (!current) continue
    const colon = line.indexOf(':')
    if (colon < 1) continue
    const descriptor = line.slice(0, colon).split(';')
    const key = descriptor.shift()!.toUpperCase()
    const params: Record<string, string> = {}
    for (const part of descriptor) {
      const equals = part.indexOf('=')
      if (equals > 0) params[part.slice(0, equals).toUpperCase()] = part.slice(equals + 1).replace(/^"|"$/g, '')
    }
    current[key] = { value: line.slice(colon + 1), params }
  }
  return events.slice(0, 5000)
}

function parseIcsDate(entry: { value: string; params: Record<string, string> }): { value: string; allDay: boolean } {
  const dateOnly = /^\d{8}$/.test(entry.value)
  const match = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})?(Z)?$/.exec(entry.value)
  const dateMatch = /^(\d{4})(\d{2})(\d{2})$/.exec(entry.value)
  if (!match && !dateMatch) throw new Error('This calendar has a date format Mike Assist cannot read.')
  const parts = match ?? dateMatch!
  const [year, month, day] = parts.slice(1, 4).map(Number)
  if (dateOnly || !match) return { value: new Date(Date.UTC(year, month - 1, day)).toISOString(), allDay: true }
  const hour = Number(match[4]); const minute = Number(match[5]); const second = Number(match[6] ?? 0)
  const time = match[7] === 'Z'
    ? new Date(Date.UTC(year, month - 1, day, hour, minute, second))
    : dateInZone(year, month, day, hour, minute, second, entry.params['TZID'])
  if (!Number.isFinite(time.getTime())) throw new Error('This calendar contains an invalid event time.')
  return { value: time.toISOString(), allDay: false }
}

function dateInZone(year: number, month: number, day: number, hour: number, minute: number, second: number, zone?: string): Date {
  if (!zone) return new Date(year, month - 1, day, hour, minute, second)
  const target = Date.UTC(year, month - 1, day, hour, minute, second)
  let guess = target
  const formatter = new Intl.DateTimeFormat('en-CA', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' })
  for (let index = 0; index < 4; index += 1) {
    const values = Object.fromEntries(formatter.formatToParts(new Date(guess)).map((part) => [part.type, part.value]))
    const observed = Date.UTC(Number(values['year']), Number(values['month']) - 1, Number(values['day']), Number(values['hour']), Number(values['minute']), Number(values['second']))
    guess += target - observed
  }
  return new Date(guess)
}

function unescapeText(value: string): string {
  return value.replace(/\\[nN]/g, '\n').replace(/\\([,;\\])/g, '$1').trim().slice(0, 500)
}
