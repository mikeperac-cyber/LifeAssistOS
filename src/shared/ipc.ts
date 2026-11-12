import type { AreaColorName, AreaIconName, CalendarEvent, CalendarEventInput, CalendarSource, JournalEntry, JournalEntryInput, LifeGoal, LifeGoalInput, PersonalContext, PlanTask, PlanTaskPriority, AssistEvent, ProviderSettings, ProviderStatus, RoutineTemplate, RoutineTemplateInput, TaskArea, TaskProject, TaskRecurrenceInput, TaskWorkflowStage, TodaySnapshot } from './types'
import type { TaskDraftSuggestion, TodoAiContext, TodoAiResult, TodoSubtaskSuggestion, TodayPlanSuggestion } from './todo-ai'
import type { AssistantChatDelta, AssistantChatRequest, AssistantChatResult } from './assistant'

export type PublicProviderSettings = Omit<ProviderSettings, 'apiKey'> & {
  hasApiKey: boolean
  apiKeyStored: boolean
  credentialReentryRequired: boolean
  savedCredentials: Array<{
    preset: ProviderSettings['preset']
    origin: string
    storedSecurely: boolean
  }>
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

export interface FolderSyncConfigResult { ok: boolean; folderPath?: string | null; passphraseSaved?: boolean; secureStorageAvailable?: boolean; error?: string; cancelled?: boolean }
export interface FolderSyncResult { ok: boolean; peerCount?: number; recordCount?: number; syncedAt?: string; error?: string }

export type ProviderAuthResult =
  | { ok: true; settings: PublicSettings; storedSecurely: boolean }
  | { ok: false; error: string }

export interface PlanMutationResult {
  ok: boolean
  error?: string
  task?: PlanTask
  snapshot?: TodaySnapshot
}

export interface ProjectMutationResult {
  ok: boolean
  error?: string
  area?: TaskArea
  project?: TaskProject
}

export interface LifeMutationResult {
  ok: boolean
  error?: string
  goal?: LifeGoal
  routine?: RoutineTemplate
  journalEntry?: JournalEntry
  tasks?: PlanTask[]
  source?: CalendarSource
}

/** The small task, AI, backup, and provider surface exposed to the renderer. */
export interface AssistApi {
  getToday(date?: string): Promise<TodaySnapshot>
  getPlanTasks(includeCompleted?: boolean): Promise<PlanTask[]>
  getMyDay(date: string): Promise<PlanTask[]>
  planTaskForDay(id: string, date: string | null): Promise<PlanMutationResult>
  reorderMyDay(date: string, ids: string[]): Promise<PlanMutationResult>
  applySuggestedMyDayOrder(date: string, ids: string[]): Promise<PlanMutationResult>
  getProjectWorkspace(): Promise<{ areas: TaskArea[]; projects: TaskProject[]; tasks: PlanTask[] }>
  createArea(input: { name: string; icon: AreaIconName; color: AreaColorName }): Promise<ProjectMutationResult>
  deleteArea(id: string): Promise<ProjectMutationResult>
  createProject(input: { name: string; description?: string; targetDate?: string | null; areaId?: string | null; goalId?: string | null }): Promise<ProjectMutationResult>
  updateProject(id: string, patch: { name?: string; description?: string; targetDate?: string | null; areaId?: string | null; goalId?: string | null }): Promise<ProjectMutationResult>
  deleteProject(id: string): Promise<ProjectMutationResult>
  addPlanTask(input: { title: string; notes?: string; dueDate?: string | null; scheduledStart?: string | null; durationMinutes?: number | null; remindAt?: string | null; priority?: PlanTaskPriority; parentTaskId?: string | null; projectId?: string | null; workflowStage?: TaskWorkflowStage; recurrenceRule?: TaskRecurrenceInput | null }): Promise<PlanMutationResult>
  updatePlanTask(id: string, patch: { title?: string; notes?: string; dueDate?: string | null; scheduledStart?: string | null; durationMinutes?: number | null; remindAt?: string | null; priority?: PlanTaskPriority; status?: PlanTask['status']; parentTaskId?: string | null; projectId?: string | null; workflowStage?: TaskWorkflowStage; recurrenceRule?: TaskRecurrenceInput | null }): Promise<PlanMutationResult>
  skipPlanTaskOccurrence(id: string): Promise<PlanMutationResult>
  captureInbox(text: string): Promise<PlanMutationResult>
  convertInbox(id: string, input?: { title?: string; notes?: string; dueDate?: string | null; scheduledStart?: string | null; durationMinutes?: number | null; remindAt?: string | null; priority?: PlanTaskPriority; projectId?: string | null; workflowStage?: TaskWorkflowStage; recurrenceRule?: TaskRecurrenceInput | null }): Promise<PlanMutationResult>
  dismissInbox(id: string): Promise<PlanMutationResult>

  getLifeWorkspace(): Promise<{ goals: LifeGoal[]; areas: TaskArea[]; projects: TaskProject[]; tasks: PlanTask[] }>
  saveLifeGoal(input: LifeGoalInput): Promise<LifeMutationResult>
  deleteLifeGoal(id: string): Promise<LifeMutationResult>
  getRoutineTemplates(): Promise<RoutineTemplate[]>
  saveRoutineTemplate(input: RoutineTemplateInput): Promise<LifeMutationResult>
  deleteRoutineTemplate(id: string): Promise<LifeMutationResult>
  applyRoutineTemplate(id: string, plannedDate: string): Promise<LifeMutationResult>
  getJournalEntries(query?: string): Promise<JournalEntry[]>
  saveJournalEntry(input: JournalEntryInput): Promise<LifeMutationResult>
  deleteJournalEntry(id: string): Promise<LifeMutationResult>
  getPersonalContext(): Promise<PersonalContext>
  savePersonalContext(input: Pick<PersonalContext, 'aboutMe' | 'preferences' | 'currentFocus'>): Promise<PersonalContext>
  getCalendarSources(): Promise<CalendarSource[]>
  getCalendarEvents(start: string, end: string): Promise<CalendarEvent[]>
  importCalendar(sourceId: string | null, name: string, events: CalendarEventInput[]): Promise<LifeMutationResult>
  deleteCalendarSource(id: string): Promise<LifeMutationResult>

  suggestTaskDraft(text: string, context: TodoAiContext): Promise<TodoAiResult<TaskDraftSuggestion>>
  suggestTaskSubtasks(task: Pick<PlanTask, 'title' | 'notes' | 'dueDate' | 'priority'>): Promise<TodoAiResult<TodoSubtaskSuggestion[]>>
  suggestTodayPlan(tasks: Array<Pick<PlanTask, 'id' | 'title' | 'dueDate' | 'priority'>>, context: TodoAiContext): Promise<TodoAiResult<TodayPlanSuggestion>>
  assistantChat(request: AssistantChatRequest): Promise<AssistantChatResult>
  cancelAssistantChat(requestId: string): Promise<boolean>
  onAssistantDelta(listener: (delta: AssistantChatDelta) => void): () => void

  createBackup(passphrase?: string): Promise<BackupResult>
  restoreBackup(passphrase?: string): Promise<BackupResult>
  getFolderSyncConfig(): Promise<FolderSyncConfigResult>
  chooseFolderSync(): Promise<FolderSyncConfigResult>
  forgetFolderSyncPassphrase(): Promise<FolderSyncConfigResult>
  syncFolderSync(passphrase: string, rememberPassphrase: boolean): Promise<FolderSyncResult>
  getSettings(): Promise<PublicSettings>
  updateSettings(patch: SettingsPatch): Promise<SettingsResult>
  removeProviderCredential(preset: ProviderSettings['preset'], baseUrl: string): Promise<SettingsResult>
  testProvider(): Promise<ProviderStatus>
  connectOpenRouter(): Promise<ProviderAuthResult>
  cancelOpenRouterSignIn(): Promise<void>
  onEvent(listener: (event: AssistEvent) => void): () => void
}
