import type { PlanTaskPriority } from '../../../shared/types'
import type { TaskDraftSuggestion } from '../../../shared/todo-ai'

export interface TaskDraftValues {
  title: string
  notes: string
  dueDate: string | null
  remindAt: string | null
  priority: PlanTaskPriority
}

export function applyTaskDraft(suggestion: TaskDraftSuggestion): TaskDraftValues {
  return {
    title: suggestion.title,
    notes: suggestion.notes,
    dueDate: suggestion.dueDate,
    remindAt: suggestion.remindAt,
    priority: suggestion.priority
  }
}

/** Called only by the review UI's explicit confirm button. */
export async function confirmTaskDraft(
  suggestion: TaskDraftSuggestion,
  saveTask: (values: TaskDraftValues) => Promise<void>
): Promise<void> {
  await saveTask(applyTaskDraft(suggestion))
}

export function getTodoControlAvailability(providerReady: boolean, pendingAi: boolean): {
  canRunAi: boolean
  canEditTasks: true
} {
  return { canRunAi: providerReady && !pendingAi, canEditTasks: true }
}
