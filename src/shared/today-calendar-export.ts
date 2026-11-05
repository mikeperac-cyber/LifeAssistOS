import type { PlanTask } from './types'
import { isDateOnly } from './date-only'

const TASK_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export interface TodayCalendarIcsExport {
  content: string
  taskCount: number
}

export function buildTodayTasksCalendarIcs(tasks: readonly PlanTask[], generatedAt = new Date()): TodayCalendarIcsExport {
  if (!Number.isFinite(generatedAt.getTime())) throw new Error('Use a valid export timestamp.')

  const exportable = tasks.filter((task) =>
    task.status === 'open' && Boolean(task.dueDate) && isDateOnly(task.dueDate ?? '') && TASK_ID.test(task.id) && task.title.trim().length > 0
  )
  if (exportable.length === 0) return { content: '', taskCount: 0 }

  const stamp = generatedAt.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z')
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Mike Assist//Today Tasks//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH'
  ]

  for (const task of exportable) {
    const start = task.dueDate!.replace(/-/g, '')
    const end = nextDateOnly(task.dueDate!)
    lines.push(
      'BEGIN:VEVENT',
      `UID:${task.id}@mike-assist.local`,
      `DTSTAMP:${stamp}`,
      `DTSTART;VALUE=DATE:${start}`
    )
    if (end) lines.push(`DTEND;VALUE=DATE:${end}`)
    lines.push(
      `SUMMARY:${escapeIcsText(task.title)}`,
      `PRIORITY:${task.priority === 'high' ? 1 : task.priority === 'low' ? 9 : 5}`,
      'TRANSP:TRANSPARENT',
      'STATUS:CONFIRMED'
    )
    if (task.notes.trim()) lines.push(`DESCRIPTION:${escapeIcsText(task.notes)}`)
    lines.push('END:VEVENT')
  }

  lines.push('END:VCALENDAR')
  return { content: `${lines.map(foldIcsLine).join('\r\n')}\r\n`, taskCount: exportable.length }
}

function nextDateOnly(value: string): string | null {
  const next = new Date(`${value}T00:00:00.000Z`)
  next.setUTCDate(next.getUTCDate() + 1)
  const date = next.toISOString().slice(0, 10)
  return isDateOnly(date) ? date.replace(/-/g, '') : null
}

function escapeIcsText(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/\r\n?|\n/g, '\\n')
    .replace(/[\u0000-\u0009\u000b-\u001f\u007f]/g, '')
    .replace(/,/g, '\\,')
    .replace(/;/g, '\\;')
}

function foldIcsLine(line: string): string {
  let output = ''
  let lineBytes = 0
  for (const character of line) {
    const characterBytes = utf8ByteLength(character)
    if (lineBytes + characterBytes > 75) {
      output += '\r\n '
      lineBytes = 1
    }
    output += character
    lineBytes += characterBytes
  }
  return output
}

function utf8ByteLength(character: string): number {
  const codePoint = character.codePointAt(0) ?? 0
  if (codePoint <= 0x7f) return 1
  if (codePoint <= 0x7ff) return 2
  return codePoint <= 0xffff ? 3 : 4
}
