import { describe, expect, it } from 'vitest'
import { auditEmptyMessage } from '../src/renderer/src/components/AuditView'
import { getNextCoachArea } from '../src/renderer/src/components/CoachView'
import { SCHEDULED_TASK_STARTERS } from '../src/renderer/src/components/ScheduledTasksView'
import { vaultEmptyMessage } from '../src/renderer/src/components/VaultView'

describe('renderer view states', () => {
  it('describes an actually empty vault separately from a search with no matches', () => {
    expect(vaultEmptyMessage('')).toBe('No documents yet. Capture a source from Research or write your first note.')
    expect(vaultEmptyMessage('  ')).toBe('No documents yet. Capture a source from Research or write your first note.')
    expect(vaultEmptyMessage('grammar notes')).toBe('No documents match “grammar notes”.')
  })

  it('distinguishes a genuinely empty audit log from a filter with no matches', () => {
    expect(auditEmptyMessage(0, 'all')).toBe('No events yet. Every message, decision, and tool run lands here.')
    expect(auditEmptyMessage(12, 'decisions')).toBe('No events match the decisions filter.')
  })

  it('moves between coaching tabs with arrow and edge keys', () => {
    expect(getNextCoachArea('personal', 'ArrowRight')).toBe('lb_english')
    expect(getNextCoachArea('lb_english', 'ArrowRight')).toBe('personal')
    expect(getNextCoachArea('personal', 'ArrowLeft')).toBe('lb_english')
    expect(getNextCoachArea('lb_english', 'ArrowLeft')).toBe('personal')
    expect(getNextCoachArea('lb_english', 'Home')).toBe('personal')
    expect(getNextCoachArea('personal', 'End')).toBe('lb_english')
    expect(getNextCoachArea('personal', 'Enter')).toBeNull()
  })

  it('offers editable, read-only routine starters across personal, business, and study check-ins', () => {
    expect(SCHEDULED_TASK_STARTERS.map((starter) => starter.id)).toEqual([
      'morning-priorities',
      'weekly-life-review',
      'business-review',
      'study-session'
    ])
    expect(SCHEDULED_TASK_STARTERS.every((starter) => starter.name.trim() && starter.prompt.length > 5)).toBe(true)
    expect(SCHEDULED_TASK_STARTERS.every((starter) => /do not (change|update)/i.test(starter.prompt))).toBe(true)
    expect(SCHEDULED_TASK_STARTERS.every((starter) => starter.kind !== 'once' && /^([01]\d|2[0-3]):[0-5]\d$/.test(starter.time))).toBe(true)
  })
})
