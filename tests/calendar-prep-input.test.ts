import { describe, expect, it } from 'vitest'
import { isCalendarPrepTaskInput } from '../src/shared/calendar-prep-input'

describe('calendar prep task IPC input', () => {
  it('accepts Google all-day events with date-only bounds and long provider IDs', () => {
    expect(isCalendarPrepTaskInput({
      provider: 'google_calendar',
      eventId: 'g'.repeat(1_024),
      eventTitle: 'Study day',
      start: '2026-11-05',
      end: '2026-11-06',
      isAllDay: true
    })).toBe(true)
  })

  it('accepts timed events and rejects invalid dates, nonpositive ranges, and date-only timed events', () => {
    const timed = {
      provider: 'microsoft_calendar',
      eventId: 'outlook-event-123',
      eventTitle: 'Planning session',
      start: '2026-11-05T10:00:00.000Z',
      end: '2026-11-05T11:00:00.000Z',
      isAllDay: false
    }
    expect(isCalendarPrepTaskInput(timed)).toBe(true)
    expect(isCalendarPrepTaskInput({ ...timed, start: '2026-02-31T10:00:00.000Z' })).toBe(false)
    expect(isCalendarPrepTaskInput({ ...timed, end: timed.start })).toBe(false)
    expect(isCalendarPrepTaskInput({ ...timed, start: '2026-11-05', end: '2026-11-06' })).toBe(false)
  })
})
