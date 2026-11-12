/* Focused task and provider contracts shared by Electron and the renderer. */

export type PlanTaskStatus = 'open' | 'done' | 'cancelled'
export type PlanTaskPriority = 'low' | 'normal' | 'high'
export type TaskWorkflowStage = 'next' | 'in-progress' | 'waiting'
export type TaskRecurrenceFrequency = 'daily' | 'weekly' | 'monthly'
export interface TaskRecurrenceInput {
  frequency: TaskRecurrenceFrequency
  /** Sunday = 0 through Saturday = 6. Required for weekly repeats. */
  weekdays?: number[]
  /** Inclusive local calendar date. */
  endsOn?: string | null
}
export interface TaskRecurrenceRule extends TaskRecurrenceInput {
  /** Stable calendar day for monthly repeats (1–31). */
  monthDay?: number
}
export type AreaIconName = 'briefcase' | 'home' | 'book' | 'leaf'
export type AreaColorName = 'teal' | 'blue' | 'amber' | 'violet'

export interface TaskArea {
  id: string
  name: string
  icon: AreaIconName
  color: AreaColorName
  sortOrder: number
  createdAt: string
}

export interface TaskProject {
  id: string
  name: string
  description: string
  targetDate: string | null
  areaId: string | null
  goalId?: string | null
  createdAt: string
  updatedAt: string
}

export interface PlanTask {
  id: string
  title: string
  notes: string
  dueDate: string | null
  /** Intention for when to work on this task, independent of its due date. */
  plannedDate?: string | null
  /** User-controlled order within a planned day. */
  dayOrder?: number | null
  scheduledStart?: string | null
  durationMinutes?: number | null
  projectId?: string | null
  workflowStage?: TaskWorkflowStage
  /** Local one-time reminder instant stored as canonical UTC ISO-8601. */
  remindAt: string | null
  priority: PlanTaskPriority
  status: PlanTaskStatus
  createdAt: string
  updatedAt: string
  completedAt: string | null
  parentTaskId: string | null
  sourceInboxId?: string
  recurrenceRule: TaskRecurrenceRule | null
  /** Original scheduled date for this occurrence, unchanged by rescheduling. */
  recurrenceDate: string | null
  recurrenceSeriesId: string | null
}

export type LifeGoalStatus = 'active' | 'paused' | 'done'
export interface LifeGoal {
  id: string
  title: string
  description: string
  areaId: string | null
  status: LifeGoalStatus
  targetDate: string | null
  createdAt: string
  updatedAt: string
}

export interface LifeGoalInput {
  id?: string
  title: string
  description?: string
  areaId?: string | null
  status?: LifeGoalStatus
  targetDate?: string | null
}

export interface RoutineTemplate {
  id: string
  name: string
  description: string
  areaId: string | null
  projectId: string | null
  title: string
  notes: string
  priority: PlanTaskPriority
  subtasks: Array<{ title: string; notes: string }>
  recurrenceRule: TaskRecurrenceInput | null
  createdAt: string
  updatedAt: string
}

export interface RoutineTemplateInput {
  id?: string
  name: string
  description?: string
  areaId?: string | null
  projectId?: string | null
  title: string
  notes?: string
  priority?: PlanTaskPriority
  subtasks?: Array<{ title: string; notes?: string }>
  recurrenceRule?: TaskRecurrenceInput | null
}

export interface JournalEntry {
  id: string
  entryDate: string
  title: string
  content: string
  areaId: string | null
  goalId: string | null
  createdAt: string
  updatedAt: string
}

export interface JournalEntryInput {
  id?: string
  entryDate: string
  title?: string
  content: string
  areaId?: string | null
  goalId?: string | null
}

export interface CalendarEvent {
  id: string
  sourceId: string
  externalUid: string | null
  title: string
  startsAt: string
  endsAt: string
  allDay: boolean
  location: string
}

export interface CalendarEventInput {
  externalUid?: string | null
  title: string
  startsAt: string
  endsAt: string
  allDay?: boolean
  location?: string
}

export interface CalendarSource {
  id: string
  name: string
  importedAt: string
  eventCount: number
}

export interface PersonalContext {
  aboutMe: string
  preferences: string
  currentFocus: string
  updatedAt: string
}

export interface InboxItem {
  id: string
  text: string
  createdAt: string
  convertedTaskId: string | null
  dismissedAt: string | null
}

export interface TodaySnapshot {
  date: string
  tasks: PlanTask[]
  inbox: InboxItem[]
}

/** Provider connection settings. The API key is main-process-only. */
export interface ProviderSettings {
  preset:
    | 'openai'
    | 'anthropic'
    | 'gemini'
    | 'openrouter'
    | 'groq'
    | 'deepseek'
    | 'mistral'
    | 'xai'
    | 'nvidia'
    | 'together'
    | 'fireworks'
    | 'cerebras'
    | 'ollama'
    | 'lmstudio'
    | 'custom'
  baseUrl: string
  model: string
  fastModel?: string
  visionModel?: string
  keepInBackground?: boolean
  /** Only present in memory after the user enters it; persisted encrypted. */
  apiKey?: string
  contextLength: number
  temperature: number
  maxSteps: number
}

export interface AppSettings {
  provider: ProviderSettings
}

export interface ProviderStatus {
  ok: boolean
  message: string
  models?: string[]
}

export type AssistEvent =
  | { type: 'quick_capture_requested' }
  | { type: 'today_changed' }
