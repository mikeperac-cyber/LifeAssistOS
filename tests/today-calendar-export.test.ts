import { describe, expect, it } from 'vitest'
import type { PlanTask } from '../src/shared/types'
import { buildTodayTasksCalendarIcs } from '../src/shared/today-calendar-export'

function task(overrides: Partial<PlanTask> = {}): PlanTask {
  return {
    id: '123e4567-e89b-42d3-a456-426614174000',
    title: 'Prepare lesson',
    notes: '',
    dueDate: '2026-11-06',
    remindAt: null,
    priority: 'normal',
    status: 'open',
    createdAt: '2026-11-05T00:00:00.000Z',
    updatedAt: '2026-11-05T00:00:00.000Z',
    completedAt: null,
    ...overrides
  }
}

describe('Today task iCalendar export', () => {
  it('exports open dated tasks as non-blocking all-day events with an exclusive end date', () => {
    const result = buildTodayTasksCalendarIcs([
      task({ title: 'Leap day', dueDate: '2028-02-29', priority: 'high' }),
      task({ id: '123e4567-e89b-42d3-a456-426614174001', title: 'No date', dueDate: null }),
      task({ id: '123e4567-e89b-42d3-a456-426614174002', title: 'Done', status: 'done' })
    ], new Date('2026-11-05T12:34:56.789Z'))

    expect(result.taskCount).toBe(1)
    expect(result.content).toContain('DTSTAMP:20261105T123456Z')
    expect(result.content).toContain('DTSTART;VALUE=DATE:20280229')
    expect(result.content).toContain('DTEND;VALUE=DATE:20280301')
    expect(result.content).toContain('PRIORITY:1')
    expect(result.content).toContain('TRANSP:TRANSPARENT')
    expect(result.content.match(/BEGIN:VEVENT/g)).toHaveLength(1)
  })

  it('escapes text values and folds long UTF-8 lines without splitting characters', () => {
    const title = `${'çok uzun başlık '.repeat(12)}, with; punctuation \\ done`
    const notes = 'First line\r\nSecond line, with; separators'
    const result = buildTodayTasksCalendarIcs([task({ title, notes })])
    const physicalLines = result.content.split('\r\n').filter(Boolean)
    const unfolded = result.content.replace(/\r\n[ \t]/g, '')

    expect(physicalLines.every((line) => Buffer.byteLength(line, 'utf8') <= 75)).toBe(true)
    expect(result.content).not.toMatch(/(?<!\r)\n/)
    expect(unfolded).toContain(`SUMMARY:${title.replace(/\\/g, '\\\\').replace(/,/g, '\\,').replace(/;/g, '\\;')}`)
    expect(unfolded).toContain('DESCRIPTION:First line\\nSecond line\\, with\\; separators')
  })

  it('returns no file content when nothing can be exported and rejects invalid timestamps', () => {
    expect(buildTodayTasksCalendarIcs([task({ dueDate: null })])).toEqual({ content: '', taskCount: 0 })
    expect(() => buildTodayTasksCalendarIcs([], new Date(Number.NaN))).toThrow(/valid export timestamp/)
  })
})
