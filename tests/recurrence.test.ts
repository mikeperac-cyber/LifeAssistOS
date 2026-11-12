import { describe, expect, it } from 'vitest'
import { getNextRecurrenceDate, normalizeRecurrenceRule } from '../src/core/recurrence'

describe('recurrence date rules', () => {
  it('advances a daily routine by one calendar day', () => {
    expect(getNextRecurrenceDate({ frequency: 'daily' }, '2026-11-10')).toBe('2026-11-11')
  })

  it('chooses the next selected weekday strictly after the lower bound', () => {
    expect(getNextRecurrenceDate({ frequency: 'weekly', weekdays: [1, 3, 5] }, '2026-11-10')).toBe('2026-11-11')
  })

  it('includes the end date but creates nothing beyond it', () => {
    const rule = { frequency: 'daily' as const, endsOn: '2026-11-11' }
    expect(getNextRecurrenceDate(rule, '2026-11-10')).toBe('2026-11-11')
    expect(getNextRecurrenceDate(rule, '2026-11-11')).toBeNull()
  })

  it('keeps a monthly day number stable when a month is shorter', () => {
    expect(getNextRecurrenceDate({ frequency: 'monthly' }, '2026-01-31', 31)).toBe('2026-02-28')
    expect(getNextRecurrenceDate({ frequency: 'monthly' }, '2026-02-28', 31)).toBe('2026-03-31')
  })

  it('clamps a leap-year monthly occurrence to February 29', () => {
    expect(getNextRecurrenceDate({ frequency: 'monthly' }, '2028-01-31', 31)).toBe('2028-02-29')
  })

  it('rejects invalid weekdays and dates instead of silently changing the rule', () => {
    expect(() => normalizeRecurrenceRule({ frequency: 'weekly', weekdays: [7] }, '2026-11-10')).toThrow(/weekday/i)
    expect(() => normalizeRecurrenceRule({ frequency: 'daily' }, '2026-02-30')).toThrow(/date/i)
  })
})
