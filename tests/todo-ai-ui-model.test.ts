import { describe, expect, it, vi } from 'vitest'
import type { TaskDraftSuggestion } from '../src/shared/todo-ai'
import { applyTaskDraft, confirmTaskDraft, getTodoControlAvailability } from '../src/renderer/src/components/todo-ai-ui-model'

describe('todo AI UI model', () => {
  it('test_ai_suggestions_require_explicit_save_action', async () => {
    const suggestion: TaskDraftSuggestion = {
      title: 'Call the dentist',
      notes: 'Ask about Tuesday availability.',
      dueDate: '2026-11-10',
      remindAt: '2026-11-10T06:00:00.000Z',
      priority: 'high'
    }
    const saveTask = vi.fn(async (_values: ReturnType<typeof applyTaskDraft>) => undefined)

    // Receiving and reviewing a suggestion alone performs no task mutation.
    const reviewedSuggestion: TaskDraftSuggestion = { ...suggestion }
    expect(saveTask).not.toHaveBeenCalled()
    expect(reviewedSuggestion.title).toBe('Call the dentist')

    // The task mutation is reachable only through the explicit confirm action.
    await confirmTaskDraft(reviewedSuggestion, saveTask)
    expect(saveTask).toHaveBeenCalledWith({
      title: 'Call the dentist',
      notes: 'Ask about Tuesday availability.',
      dueDate: '2026-11-10',
      remindAt: '2026-11-10T06:00:00.000Z',
      priority: 'high'
    })
  })

  it('keeps local task controls available when AI is unconfigured or busy', () => {
    expect(getTodoControlAvailability(false, false)).toEqual({ canRunAi: false, canEditTasks: true })
    expect(getTodoControlAvailability(true, true)).toEqual({ canRunAi: false, canEditTasks: true })
    expect(getTodoControlAvailability(true, false)).toEqual({ canRunAi: true, canEditTasks: true })
  })

  it('applies the complete editable task fields from a suggestion', () => {
    const suggestion: TaskDraftSuggestion = {
      title: 'Prepare slides',
      notes: 'Focus on the launch data.',
      dueDate: '2026-11-12',
      remindAt: null,
      priority: 'normal'
    }
    expect(applyTaskDraft(suggestion)).toEqual(suggestion)
  })
})
