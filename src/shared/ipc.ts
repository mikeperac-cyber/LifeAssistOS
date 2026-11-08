import type { PlanTask, PlanTaskPriority, AssistEvent, ProviderSettings, ProviderStatus, TodaySnapshot } from './types'
import type { TaskDraftSuggestion, TodoAiContext, TodoAiResult, TodoSubtaskSuggestion, TodayPlanSuggestion } from './todo-ai'

export type PublicProviderSettings = Omit<ProviderSettings, 'apiKey'> & {
  hasApiKey: boolean
  apiKeyStored: boolean
}

export interface PublicSettings {
  provider: PublicProviderSettings
  onboardingComplete: boolean
}

export type SettingsPatch = Partial<Omit<ProviderSettings, 'apiKey'>> & {
  apiKey?: string | null
}

export interface SettingsResult {
  ok: boolean
  error?: string
  settings?: PublicSettings
}

export interface BackupResult {
  ok: boolean
  cancelled?: boolean
  error?: string
  folderName?: string
}

export interface PlanMutationResult {
  ok: boolean
  error?: string
  task?: PlanTask
  snapshot?: TodaySnapshot
}

/** The small task, AI, backup, and provider surface exposed to the renderer. */
export interface AssistApi {
  getToday(date?: string): Promise<TodaySnapshot>
  getPlanTasks(includeCompleted?: boolean): Promise<PlanTask[]>
  addPlanTask(input: { title: string; notes?: string; dueDate?: string | null; remindAt?: string | null; priority?: PlanTaskPriority; parentTaskId?: string | null }): Promise<PlanMutationResult>
  updatePlanTask(id: string, patch: { title?: string; notes?: string; dueDate?: string | null; remindAt?: string | null; priority?: PlanTaskPriority; status?: PlanTask['status']; parentTaskId?: string | null }): Promise<PlanMutationResult>
  captureInbox(text: string): Promise<PlanMutationResult>
  convertInbox(id: string, input?: { title?: string; notes?: string; dueDate?: string | null; remindAt?: string | null; priority?: PlanTaskPriority }): Promise<PlanMutationResult>
  dismissInbox(id: string): Promise<PlanMutationResult>

  suggestTaskDraft(text: string, context: TodoAiContext): Promise<TodoAiResult<TaskDraftSuggestion>>
  suggestTaskSubtasks(task: Pick<PlanTask, 'title' | 'notes' | 'dueDate' | 'priority'>): Promise<TodoAiResult<TodoSubtaskSuggestion[]>>
  suggestTodayPlan(tasks: Array<Pick<PlanTask, 'id' | 'title' | 'dueDate' | 'priority'>>, context: TodoAiContext): Promise<TodoAiResult<TodayPlanSuggestion>>

  createBackup(passphrase?: string): Promise<BackupResult>
  restoreBackup(passphrase?: string): Promise<BackupResult>
  getSettings(): Promise<PublicSettings>
  updateSettings(patch: SettingsPatch): Promise<SettingsResult>
  testProvider(): Promise<ProviderStatus>
  onEvent(listener: (event: AssistEvent) => void): () => void
}
