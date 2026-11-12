import { describe, expect, it } from 'vitest'
import type { InboxItem, PlanTask, TaskProject } from '../src/shared/types'
import { addDays, buildReviewViewModel, startOfWeek } from '../src/renderer/src/components/review-view-model'

function task(id: string, overrides: Partial<PlanTask> = {}): PlanTask {
  return {
    id,
    title: id,
    notes: '',
    dueDate: null,
    plannedDate: null,
    dayOrder: null,
    projectId: null,
    workflowStage: 'next',
    remindAt: null,
    priority: 'normal',
    status: 'open',
    createdAt: '2026-11-01T00:00:00.000Z',
    updatedAt: '2026-11-01T00:00:00.000Z',
    completedAt: null,
    parentTaskId: null,
    recurrenceRule: null,
    recurrenceDate: null,
    recurrenceSeriesId: null,
    ...overrides
  }
}

const inbox: InboxItem[] = [
  { id: 'old', text: 'Older thought', createdAt: '2026-11-01T10:00:00.000Z', convertedTaskId: null, dismissedAt: null },
  { id: 'new', text: 'Newer thought', createdAt: '2026-11-07T10:00:00.000Z', convertedTaskId: null, dismissedAt: null }
]

describe('weekly review view model', () => {
  it('separates overdue, next-seven-day, waiting, and unplanned tasks', () => {
    const model = buildReviewViewModel({
      today: '2026-11-08',
      timeZone: 'Europe/Istanbul',
      inbox,
      areas: [],
      projects: [],
      tasks: [
        task('overdue', { dueDate: '2026-11-07', priority: 'high' }),
        task('today', { dueDate: '2026-11-08', plannedDate: '2026-11-08' }),
        task('unplanned', { dueDate: '2026-11-14' }),
        task('planned-next-week', { dueDate: '2026-11-14', plannedDate: '2026-11-14' }),
        task('outside', { dueDate: '2026-11-15' }),
        task('waiting', { workflowStage: 'waiting' }),
        task('done', { status: 'done', dueDate: '2026-11-08' })
      ]
    })

    expect(model.horizonEnd).toBe('2026-11-14')
    expect(model.weekStart).toBe('2026-11-02')
    expect(model.openCount).toBe(6)
    expect(model.overdue.map(({ id }) => id)).toEqual(['overdue'])
    expect(model.dueSoon.map(({ id }) => id)).toEqual(['today', 'planned-next-week', 'unplanned'])
    expect(model.unplannedDueSoon.map(({ id }) => id)).toEqual(['unplanned'])
    expect(model.waiting.map(({ id }) => id)).toEqual(['waiting'])
    expect(model.inbox.map(({ id }) => id)).toEqual(['new', 'old'])
  })

  it('counts completions by the user local calendar week and excludes partial weeks from the trend', () => {
    const model = buildReviewViewModel({
      today: '2026-11-08',
      timeZone: 'Europe/Istanbul',
      inbox: [],
      areas: [],
      projects: [],
      tasks: [
        task('previous-week', { status: 'done', completedAt: '2026-10-26T00:30:00.000Z' }),
        task('this-week', { status: 'done', completedAt: '2026-11-01T21:30:00.000Z' }),
        task('old', { status: 'done', completedAt: '2026-09-01T00:00:00.000Z' }),
        task('not-completed', { completedAt: null })
      ]
    })

    expect(model.completedThisWeek).toBe(1)
    expect(model.completedWeeks).toHaveLength(4)
    expect(model.completedWeeks.map((week) => [week.start, week.count])).toEqual([
      ['2026-10-05', 0],
      ['2026-10-12', 0],
      ['2026-10-19', 0],
      ['2026-10-26', 1]
    ])
  })

  it('summarizes open project work by waiting and near-term due tasks', () => {
    const project: TaskProject = { id: 'p1', name: 'Course launch', description: '', targetDate: null, areaId: 'a1', createdAt: '2026-11-01T00:00:00.000Z', updatedAt: '2026-11-01T00:00:00.000Z' }
    const model = buildReviewViewModel({
      today: '2026-11-08',
      timeZone: 'UTC',
      inbox: [],
      areas: [{ id: 'a1', name: 'Work', icon: 'briefcase', color: 'teal', sortOrder: 0, createdAt: '2026-11-01T00:00:00.000Z' }],
      projects: [project],
      tasks: [
        task('waiting', { projectId: 'p1', workflowStage: 'waiting' }),
        task('due', { projectId: 'p1', dueDate: '2026-11-12' }),
        task('done', { projectId: 'p1', status: 'done' })
      ]
    })

    expect(model.projects).toEqual([{ project, areaName: 'Work', openCount: 2, waitingCount: 1, dueSoonCount: 1 }])
  })

  it('uses calendar-safe date arithmetic across month and year boundaries', () => {
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01')
    expect(startOfWeek('2026-11-08')).toBe('2026-11-02')
  })
})
