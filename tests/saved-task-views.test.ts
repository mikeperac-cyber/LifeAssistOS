import { describe, expect, it } from 'vitest'
import type { PlanTask } from '../src/shared/types'
import { filterTasksForSavedView, parseSavedTaskViews, readSavedTaskViews, type SavedTaskView } from '../src/renderer/src/components/saved-task-views'

function task(id: string, overrides: Partial<PlanTask> = {}): PlanTask {
  return {
    id, title: id, notes: '', dueDate: null, remindAt: null, priority: 'normal', status: 'open',
    createdAt: '2026-11-01T00:00:00.000Z', updatedAt: '2026-11-01T00:00:00.000Z', completedAt: null,
    parentTaskId: null, recurrenceRule: null, recurrenceDate: null, recurrenceSeriesId: null, ...overrides
  }
}

const validSavedView: SavedTaskView = {
  id: 'weekly-study', name: 'Study this week', baseView: 'all', projectId: 'study-project',
  priority: 'high', workflowStage: 'waiting', dueDate: 'next-7-days'
}

describe('saved task views', () => {
  it('validates saved view data and limits the number of views', () => {
    const parsed = parseSavedTaskViews([
      validSavedView,
      { ...validSavedView, name: 'Bad duplicate ID' },
      { ...validSavedView, id: 'bad', baseView: 'unknown' },
      ...Array.from({ length: 15 }, (_, index) => ({ ...validSavedView, id: `view-${index}`, name: `View ${index}`, projectId: null, priority: null, workflowStage: null, dueDate: 'any' }))
    ])
    expect(parsed).toHaveLength(12)
    expect(parsed[0]).toMatchObject({ id: 'weekly-study', baseView: 'all', dueDate: 'next-7-days' })
  })

  it('falls back to no saved views when local storage cannot be read or decoded', () => {
    expect(readSavedTaskViews(() => '{broken')).toEqual([])
    expect(readSavedTaskViews(() => { throw new Error('storage unavailable') })).toEqual([])
  })

  it('combines list, project, priority, stage, and due date filters', () => {
    const tasks = [
      task('match', { projectId: 'study-project', priority: 'high', workflowStage: 'waiting', dueDate: '2026-11-16' }),
      task('wrong-project', { projectId: 'other', priority: 'high', workflowStage: 'waiting', dueDate: '2026-11-16' }),
      task('wrong-priority', { projectId: 'study-project', priority: 'normal', workflowStage: 'waiting', dueDate: '2026-11-16' }),
      task('outside-week', { projectId: 'study-project', priority: 'high', workflowStage: 'waiting', dueDate: '2026-11-17' }),
      task('completed', { projectId: 'study-project', priority: 'high', workflowStage: 'waiting', dueDate: '2026-11-16', status: 'done' })
    ]
    expect(filterTasksForSavedView(tasks, validSavedView, '2026-11-10').map(({ id }) => id)).toEqual(['match'])
  })

  it('supports explicit no-deadline views', () => {
    const view = { ...validSavedView, projectId: null, priority: null, workflowStage: null, dueDate: 'no-date' as const }
    expect(filterTasksForSavedView([task('undated'), task('dated', { dueDate: '2026-11-11' })], view, '2026-11-10').map(({ id }) => id)).toEqual(['undated'])
  })
})
