import type { PlanTaskPriority } from './types'

export interface TodoAiContext {
  /** Current calendar date in the user's local time zone, as YYYY-MM-DD. */
  localDate: string
  /** IANA time-zone identifier used to interpret relative dates. */
  timeZone: string
}

export interface TaskDraftSuggestion {
  title: string
  notes: string
  dueDate: string | null
  remindAt: string | null
  priority: PlanTaskPriority
}

export interface TodoSubtaskSuggestion {
  title: string
  notes: string
}

export interface TodayPlanSuggestion {
  /** Ordered task IDs selected from the exact list sent to the model. */
  taskIds: string[]
  rationaleByTaskId: Record<string, string>
}

export type TodoAiResult<T> =
  | { ok: true; suggestion: T }
  | { ok: false; error: string }
