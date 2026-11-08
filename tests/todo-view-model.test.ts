import { describe, expect, it } from 'vitest'
import type { PlanTask } from '../src/shared/types'
import { filterTasksByQuery, filterTasksForView, groupTasksForView } from '../src/renderer/src/components/todo-view-model'

const localDate = '2026-11-08'

function task(id: string, overrides: Partial<PlanTask> = {}): PlanTask {
  return {
    id,
    title: id,
    notes: '',
    dueDate: null,
    remindAt: null,
    priority: 'normal',
    status: 'open',
    createdAt: '2026-11-01T00:00:00.000Z',
    updatedAt: '2026-11-01T00:00:00.000Z',
    completedAt: null,
    parentTaskId: null,
    ...overrides
  }
}

describe('todo view model', () => {
  it('test_task_view_filters_use_local_date_boundary', () => {
    const tasks = [
      task('overdue', { dueDate: '2026-11-07' }),
      task('today', { dueDate: localDate }),
      task('upcoming', { dueDate: '2026-11-09' }),
      task('undated'),
      task('completed-today', { dueDate: localDate, status: 'done' })
    ]

    expect(filterTasksForView(tasks, 'today', localDate).map(({ id }) => id)).toEqual(['overdue', 'today', 'undated'])
    expect(filterTasksForView(tasks, 'upcoming', localDate).map(({ id }) => id)).toEqual(['upcoming'])
  })

  it('test_task_view_filters_exclude_done_and_archived_tasks', () => {
    const tasks = [
      task('open'),
      task('done', { status: 'done' }),
      task('archived', { status: 'cancelled' })
    ]

    expect(filterTasksForView(tasks, 'completed', localDate).map(({ id }) => id)).toEqual(['done'])
    expect(filterTasksForView(tasks, 'archived', localDate).map(({ id }) => id)).toEqual(['archived'])
  })

  it('test_task_search_handles_empty_and_punctuation_queries', () => {
    const tasks = [task('one', { title: 'Draft lesson', notes: 'Add a useful example.' }), task('two', { title: 'Plan Friday' })]

    expect(filterTasksByQuery(tasks, '')).toEqual(tasks)
    expect(filterTasksByQuery(tasks, '   !!!  ')).toEqual(tasks)
    expect(filterTasksByQuery(tasks, 'useful EXAMPLE')).toEqual([tasks[0]])
  })

  it('test_subtasks_remain_independently_visible_with_parent_context', () => {
    const parent = task('parent', { title: 'Prepare the lesson', dueDate: '2026-11-09' })
    const child = task('child', { title: 'Draft warm-up', dueDate: localDate, parentTaskId: parent.id })
    const filtered = filterTasksForView([parent, child], 'today', localDate)

    expect(filtered.map(({ id }) => id)).toEqual(['child'])
    expect(groupTasksForView(filtered, [parent, child])).toEqual([
      { task: child, contextTitle: 'Prepare the lesson', subtasks: [] }
    ])
  })
})
