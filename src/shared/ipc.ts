import type {
  AssistEvent,
  ApprovalChoice,
  AuditIntegrity,
  AuditEvent,
  ChatMessage,
  ChatImageAttachmentInput,
  ChatMode,
  ChatSession,
  FolderGrant,
  FinanceReport,
  FinanceTransactionInput,
  MemoryFact,
  MemoryFactInput,
  MemoryFactPatch,
  MemoryRecall,
  McpServerInfo,
  McpServerInput,
  ResearchProject,
  ResearchSource,
  VaultDocument,
  VaultSearchResult,
  PlanTask,
  InboxItem,
  TodaySnapshot,
  CoachArea,
  CoachingContext,
  CoachingGoal,
  CoachingJournalEntry,
  WorkflowRecord,
  WorkflowStep,
  ScheduledAgentTask,
  ScheduledAgentRun,
  ScheduledTaskSchedule,
  AssistantSkill,
  AssistantSkillInput,
  ProviderSettings,
  ProviderStatus,
  ToolResult,
  GoogleTask,
  GoogleTaskList,
  GoogleCalendarEvent,
  GoogleGmailMessageSummary,
  MicrosoftCalendarEvent,
  MicrosoftMailMessage,
  MicrosoftMailMessageSummary,
  MicrosoftTodoTask,
  MicrosoftTodoTaskList,
  CalendarTaskProvider,
  TaskExportProvider
} from './types'

export interface PublicWebSearchSettings {
  hasApiKey: boolean
  apiKeyStored: boolean
}

export interface PublicGoogleCalendarSettings {
  clientId: string
  connected: boolean
  tokenStored: boolean
}

export interface PublicGoogleGmailSettings {
  clientId: string
  connected: boolean
  tokenStored: boolean
}

export interface PublicGoogleDriveSettings {
  clientId: string
  connected: boolean
  tokenStored: boolean
}

export interface PublicGoogleTasksSettings {
  clientId: string
  connected: boolean
  tokenStored: boolean
  taskWriteEnabled: boolean
}

export interface PublicMicrosoftTodoSettings {
  clientId: string
  connected: boolean
  tokenStored: boolean
  taskWriteEnabled: boolean
}

export interface PublicMicrosoftCalendarSettings {
  clientId: string
  connected: boolean
  tokenStored: boolean
}

export interface PublicMicrosoftMailSettings {
  clientId: string
  connected: boolean
  tokenStored: boolean
}

export interface MicrosoftTodoConnectPrompt {
  userCode: string
  verificationUri: string
  expiresAt: number
}

export interface MicrosoftTodoConnectStatus {
  phase: 'idle' | 'starting' | 'pending' | 'connected' | 'failed' | 'cancelled'
  prompt?: MicrosoftTodoConnectPrompt
  error?: string
}

export interface MicrosoftCalendarConnectPrompt {
  userCode: string
  verificationUri: string
  expiresAt: number
}

export interface MicrosoftCalendarConnectStatus {
  phase: 'idle' | 'starting' | 'pending' | 'connected' | 'failed' | 'cancelled'
  prompt?: MicrosoftCalendarConnectPrompt
  error?: string
}

export interface MicrosoftMailConnectPrompt {
  userCode: string
  verificationUri: string
  expiresAt: number
}

export interface MicrosoftMailConnectStatus {
  phase: 'idle' | 'starting' | 'pending' | 'connected' | 'failed' | 'cancelled'
  prompt?: MicrosoftMailConnectPrompt
  error?: string
}

export interface SendResult {
  ok: boolean
  error?: string
}

export interface GrantMutationResult {
  ok: boolean
  error?: string
  cancelled?: boolean
  grants?: FolderGrant[]
}

export interface DomainMutationResult {
  ok: boolean
  error?: string
  domains?: string[]
}

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

export interface LocalApiStatus {
  enabled: boolean
  baseUrl?: string
  token?: string
  model?: string
}

export interface LocalApiResult {
  ok: boolean
  error?: string
  status?: LocalApiStatus
}

export interface WebSearchSettingsResult {
  ok: boolean
  error?: string
  settings?: PublicWebSearchSettings
}

export interface GoogleCalendarSettingsResult {
  ok: boolean
  error?: string
  message?: string
  settings?: PublicGoogleCalendarSettings
}

export interface GoogleGmailSettingsResult {
  ok: boolean
  error?: string
  message?: string
  settings?: PublicGoogleGmailSettings
}

export interface GoogleDriveSettingsResult {
  ok: boolean
  error?: string
  message?: string
  settings?: PublicGoogleDriveSettings
}

export interface GoogleTasksSettingsResult {
  ok: boolean
  error?: string
  message?: string
  settings?: PublicGoogleTasksSettings
}

export interface GoogleTaskListsReadResult {
  ok: boolean
  error?: string
  lists?: GoogleTaskList[]
  nextPageToken?: string
  settings?: PublicGoogleTasksSettings
}

export interface GoogleTasksReadResult {
  ok: boolean
  error?: string
  tasks?: GoogleTask[]
  nextPageToken?: string
  settings?: PublicGoogleTasksSettings
}

export interface TodayTaskExportInput {
  provider: TaskExportProvider
  taskId: string
  expectedUpdatedAt: string
  taskListId: string
  taskListTitle: string
}

export interface TodayTaskExportClearInput {
  provider: TaskExportProvider
  taskId: string
  taskListId: string
}

export interface TodayTaskExportActionResult {
  ok: boolean
  output?: unknown
  error?: string
  denied?: boolean
  outcomeUnknown?: boolean
}

export interface CalendarPrepTaskInput {
  provider: CalendarTaskProvider
  eventId: string
  eventTitle: string
  start: string
  end: string
  isAllDay: boolean
  location?: string
}

export interface MicrosoftTodoSettingsResult {
  ok: boolean
  error?: string
  message?: string
  settings?: PublicMicrosoftTodoSettings
  prompt?: MicrosoftTodoConnectPrompt
}

export interface MicrosoftTodoConnectStatusResult {
  ok: boolean
  error?: string
  status?: MicrosoftTodoConnectStatus
  settings?: PublicMicrosoftTodoSettings
}

export interface MicrosoftTodoTaskListsReadResult {
  ok: boolean
  error?: string
  lists?: MicrosoftTodoTaskList[]
  nextPageToken?: string
  settings?: PublicMicrosoftTodoSettings
}

export interface MicrosoftTodoTasksReadResult {
  ok: boolean
  error?: string
  tasks?: MicrosoftTodoTask[]
  nextPageToken?: string
  settings?: PublicMicrosoftTodoSettings
}

export interface MicrosoftCalendarSettingsResult {
  ok: boolean
  error?: string
  message?: string
  settings?: PublicMicrosoftCalendarSettings
  prompt?: MicrosoftCalendarConnectPrompt
}

export interface MicrosoftCalendarConnectStatusResult {
  ok: boolean
  error?: string
  status?: MicrosoftCalendarConnectStatus
  settings?: PublicMicrosoftCalendarSettings
}

export interface MicrosoftCalendarEventsReadResult {
  ok: boolean
  error?: string
  events?: MicrosoftCalendarEvent[]
  nextPageToken?: string
  settings?: PublicMicrosoftCalendarSettings
}

export interface GoogleCalendarEventsReadResult {
  ok: boolean
  error?: string
  events?: GoogleCalendarEvent[]
  nextPageToken?: string
  settings?: PublicGoogleCalendarSettings
}

export interface MicrosoftMailSettingsResult {
  ok: boolean
  error?: string
  message?: string
  settings?: PublicMicrosoftMailSettings
  prompt?: MicrosoftMailConnectPrompt
}

export interface MicrosoftMailConnectStatusResult {
  ok: boolean
  error?: string
  status?: MicrosoftMailConnectStatus
  settings?: PublicMicrosoftMailSettings
}

export interface MicrosoftMailSearchResult {
  ok: boolean
  error?: string
  messages?: MicrosoftMailMessageSummary[]
  nextPageToken?: string
  settings?: PublicMicrosoftMailSettings
}

export interface GoogleGmailSearchResult {
  ok: boolean
  error?: string
  messages?: GoogleGmailMessageSummary[]
  nextPageToken?: string
  settings?: PublicGoogleGmailSettings
}

export interface EmailFollowupTaskInput {
  provider: 'gmail' | 'outlook'
  messageId: string
  title: string
}

export interface MicrosoftMailReadResult {
  ok: boolean
  error?: string
  message?: MicrosoftMailMessage
  settings?: PublicMicrosoftMailSettings
}

export interface ChatState {
  sessions: ChatSession[]
  activeSessionId: string
  messages: ChatMessage[]
}

export interface ChatStateResult {
  ok: boolean
  error?: string
  state?: ChatState
}

export interface AuditExportResult {
  ok: boolean
  cancelled?: boolean
  error?: string
  fileName?: string
}

export interface BackupResult {
  ok: boolean
  cancelled?: boolean
  error?: string
  warning?: string
  folderName?: string
}

export interface WorkflowMutationResult {
  ok: boolean
  error?: string
  workflows?: WorkflowRecord[]
}

export interface WorkflowRunResult {
  ok: boolean
  error?: string
  completedSteps: number
  totalSteps: number
}

export interface ScheduledTaskMutationResult {
  ok: boolean
  error?: string
  task?: ScheduledAgentTask
  tasks?: ScheduledAgentTask[]
  runs?: ScheduledAgentRun[]
}

export interface ScheduledTaskRunResult {
  ok: boolean
  error?: string
  warning?: string
  task?: ScheduledAgentTask
}

export interface SkillMutationResult {
  ok: boolean
  error?: string
  skills?: AssistantSkill[]
}

export interface SpeechResult {
  ok: boolean
  text?: string
  error?: string
}

export interface MemoryListResult {
  ok: boolean
  error?: string
  facts?: MemoryFact[]
}

export interface MemoryMutationResult {
  ok: boolean
  error?: string
  fact?: MemoryFact
}

export interface MemoryRecallResult {
  ok: boolean
  error?: string
  recall?: MemoryRecall
}

export interface McpMutationResult {
  ok: boolean
  error?: string
  servers?: McpServerInfo[]
}

export interface McpImportResult {
  ok: boolean
  error?: string
  added?: number
  skipped?: number
  servers?: McpServerInfo[]
}

export interface ResearchMutationResult {
  ok: boolean
  error?: string
  projects?: ResearchProject[]
  project?: ResearchProject
  source?: ResearchSource
}

export interface VaultMutationResult {
  ok: boolean
  error?: string
  document?: VaultDocument
  documents?: VaultDocument[]
}

export interface PlanMutationResult {
  ok: boolean
  error?: string
  task?: PlanTask
  tasks?: PlanTask[]
  inbox?: InboxItem[]
  snapshot?: TodaySnapshot
}

export interface CoachingMutationResult {
  ok: boolean
  error?: string
  context?: CoachingContext
  goal?: CoachingGoal
  entry?: CoachingJournalEntry
}

/** The entire surface exposed to the sandboxed renderer. */
export interface AssistApi {
  sendMessage(text: string, mode?: ChatMode, attachments?: ChatImageAttachmentInput[]): Promise<SendResult>
  cancel(): Promise<void>
  respondPermission(requestId: string, choice: ApprovalChoice): Promise<void>
  getAudit(): Promise<AuditEvent[]>
  getAuditIntegrity(): Promise<AuditIntegrity>
  exportAudit(): Promise<AuditExportResult>
  getChatState(): Promise<ChatStateResult>
  createChat(): Promise<ChatStateResult>
  switchChat(sessionId: string): Promise<ChatStateResult>
  renameChat(sessionId: string, title: string): Promise<ChatStateResult>
  deleteChat(sessionId: string): Promise<ChatStateResult>
  deleteChatMessage(sessionId: string, messageId: string): Promise<ChatStateResult>
  exportChat(sessionId: string): Promise<AuditExportResult>
  searchChats(query: string, mode?: ChatMode): Promise<ChatSession[]>

  getGrants(): Promise<FolderGrant[]>
  /** Opens the native folder picker, then adds the chosen folder. */
  addGrant(access: 'read' | 'read-write'): Promise<GrantMutationResult>
  removeGrant(id: string): Promise<GrantMutationResult>
  setGrantAccess(id: string, access: 'read' | 'read-write'): Promise<GrantMutationResult>

  getAllowedDomains(): Promise<string[]>
  addAllowedDomain(host: string): Promise<DomainMutationResult>
  removeAllowedDomain(host: string): Promise<DomainMutationResult>
  createBackup(passphrase?: string): Promise<BackupResult>
  restoreBackup(passphrase?: string): Promise<BackupResult>
  getFinanceReport(period: 'week' | 'month'): Promise<FinanceReport>
  recordFinanceTransaction(input: FinanceTransactionInput): Promise<ToolResult>
  exportFinanceCsv(): Promise<AuditExportResult>
  importFinanceCsv(): Promise<{ ok: boolean; cancelled?: boolean; imported?: number; error?: string }>
  getWorkflows(): Promise<WorkflowRecord[]>
  saveWorkflow(input: { name: string; prompt: string; steps: WorkflowStep[] }): Promise<WorkflowMutationResult>
  removeWorkflow(id: string): Promise<WorkflowMutationResult>
  runWorkflow(id: string, params?: Record<string, string>): Promise<WorkflowRunResult>
  getScheduledTasks(): Promise<ScheduledAgentTask[]>
  getScheduledTaskRuns(taskId?: string): Promise<ScheduledAgentRun[]>
  createScheduledTask(input: { name: string; prompt: string; mode: ChatMode; schedule: ScheduledTaskSchedule }): Promise<ScheduledTaskMutationResult>
  setScheduledTaskEnabled(id: string, enabled: boolean): Promise<ScheduledTaskMutationResult>
  removeScheduledTask(id: string): Promise<ScheduledTaskMutationResult>
  runScheduledTask(id: string): Promise<ScheduledTaskRunResult>

  getSkills(): Promise<AssistantSkill[]>
  saveSkill(input: AssistantSkillInput): Promise<SkillMutationResult>
  setSkillEnabled(id: string, enabled: boolean): Promise<SkillMutationResult>
  deleteSkill(id: string): Promise<SkillMutationResult>

  /** Active facts, or the best matches for a keyword query. */
  getMemory(query?: string): Promise<MemoryFact[]>
  /** Saves through the permission gateway, so the user always approves first. */
  addMemory(input: MemoryFactInput): Promise<ToolResult>
  updateMemory(id: string, patch: MemoryFactPatch): Promise<MemoryMutationResult>
  archiveMemory(id: string): Promise<MemoryMutationResult>
  /** Removes the fact permanently; the renderer must confirm with typed text. */
  deleteMemory(id: string): Promise<MemoryMutationResult>
  recallMemory(query: string, limit?: number): Promise<MemoryRecallResult>

  /** MCP connector management; connection status lives in the main process. */
  getMcpServers(): Promise<McpServerInfo[]>
  addMcpServer(input: McpServerInput): Promise<McpMutationResult>
  updateMcpServer(id: string, patch: Partial<McpServerInput>): Promise<McpMutationResult>
  removeMcpServer(id: string): Promise<McpMutationResult>
  refreshMcpServer(id: string): Promise<McpMutationResult>
  /** Imports a Claude-Desktop-style `{ "mcpServers": { … } }` JSON block. */
  importMcpConfig(text: string): Promise<McpImportResult>
  getResearchProjects(includeArchived?: boolean): Promise<ResearchProject[]>
  createResearchProject(input: { title: string; question: string }): Promise<ResearchMutationResult>
  archiveResearchProject(id: string): Promise<ResearchMutationResult>
  removeResearchProject(id: string): Promise<ResearchMutationResult>
  addResearchSource(input: { projectId: string; url: string }): Promise<ResearchMutationResult>
  removeResearchSource(id: string): Promise<ResearchMutationResult>
  getVaultDocuments(query?: string): Promise<VaultSearchResult[]>
  createVaultDocument(input: { title: string; body: string; tags?: string[]; sourceType?: string; sourceRef?: string }): Promise<VaultMutationResult>
  updateVaultDocument(id: string, patch: { title?: string; body?: string; tags?: string[] }): Promise<VaultMutationResult>
  deleteVaultDocument(id: string): Promise<VaultMutationResult>
  getToday(date?: string): Promise<TodaySnapshot>
  getPlanTasks(includeCompleted?: boolean): Promise<PlanTask[]>
  addPlanTask(input: { title: string; notes?: string; dueDate?: string | null; remindAt?: string | null; priority?: string; sourceGoalId?: string }): Promise<PlanMutationResult>
  updatePlanTask(id: string, patch: { title?: string; notes?: string; dueDate?: string | null; remindAt?: string | null; priority?: string; status?: string }): Promise<PlanMutationResult>
  captureInbox(text: string): Promise<PlanMutationResult>
  convertInbox(id: string, input?: { title?: string; dueDate?: string | null; priority?: string }): Promise<PlanMutationResult>
  dismissInbox(id: string): Promise<PlanMutationResult>
  getCoachingContext(): Promise<CoachingContext>
  updateCoachingProfile(patch: { style?: string; reflectionRetention?: string; boundaries?: string }): Promise<CoachingMutationResult>
  createCoachingGoal(input: { area: CoachArea; title: string; why?: string; targetDate?: string | null; milestones?: string[] }): Promise<CoachingMutationResult>
  updateCoachingGoal(id: string, patch: { title?: string; why?: string; targetDate?: string | null; status?: string; milestones?: Array<{ id: string; title: string; done: boolean }> }): Promise<CoachingMutationResult>
  saveCoachingJournal(input: { area: CoachArea; kind: 'daily' | 'weekly'; body: string }): Promise<ToolResult>
  getCoachingJournal(area?: CoachArea): Promise<CoachingJournalEntry[]>
  getSpeechEndpoint(): Promise<string>
  updateSpeechEndpoint(endpoint: string): Promise<{ ok: boolean; endpoint?: string; error?: string }>
  transcribeAudio(audio: Uint8Array, mimeType: string): Promise<SpeechResult>
  completeOnboarding(): Promise<SettingsResult>

  getSettings(): Promise<PublicSettings>
  updateSettings(patch: SettingsPatch): Promise<SettingsResult>
  getLocalApiStatus(): Promise<LocalApiStatus>
  setLocalApiEnabled(enabled: boolean): Promise<LocalApiResult>
  testProvider(): Promise<ProviderStatus>
  getWebSearchSettings(): Promise<PublicWebSearchSettings>
  updateWebSearchApiKey(apiKey: string | null): Promise<WebSearchSettingsResult>
  getGoogleCalendarSettings(): Promise<PublicGoogleCalendarSettings>
  updateGoogleCalendarClientId(clientId: string): Promise<GoogleCalendarSettingsResult>
  connectGoogleCalendar(): Promise<GoogleCalendarSettingsResult>
  disconnectGoogleCalendar(): Promise<GoogleCalendarSettingsResult>
  listGoogleCalendarEvents(timeMin: string, timeMax: string, pageToken?: string): Promise<GoogleCalendarEventsReadResult>
  getGoogleGmailSettings(): Promise<PublicGoogleGmailSettings>
  updateGoogleGmailClientId(clientId: string): Promise<GoogleGmailSettingsResult>
  connectGoogleGmail(): Promise<GoogleGmailSettingsResult>
  disconnectGoogleGmail(): Promise<GoogleGmailSettingsResult>
  searchGoogleGmailMessages(query: string, pageToken?: string): Promise<GoogleGmailSearchResult>
  getGoogleDriveSettings(): Promise<PublicGoogleDriveSettings>
  updateGoogleDriveClientId(clientId: string): Promise<GoogleDriveSettingsResult>
  connectGoogleDrive(): Promise<GoogleDriveSettingsResult>
  disconnectGoogleDrive(): Promise<GoogleDriveSettingsResult>
  getGoogleTasksSettings(): Promise<PublicGoogleTasksSettings>
  updateGoogleTasksClientId(clientId: string): Promise<GoogleTasksSettingsResult>
  connectGoogleTasks(): Promise<GoogleTasksSettingsResult>
  disconnectGoogleTasks(): Promise<GoogleTasksSettingsResult>
  listGoogleTaskLists(pageToken?: string): Promise<GoogleTaskListsReadResult>
  listGoogleTasks(taskListId: string, pageToken?: string): Promise<GoogleTasksReadResult>
  exportTodayTask(input: TodayTaskExportInput): Promise<TodayTaskExportActionResult>
  clearTodayTaskExportRetryGuard(input: TodayTaskExportClearInput): Promise<TodayTaskExportActionResult>
  syncTodayTask(input: TodayTaskExportInput): Promise<TodayTaskExportActionResult>
  clearTodayTaskSyncRetryGuard(input: TodayTaskExportClearInput): Promise<TodayTaskExportActionResult>

  getMicrosoftTodoSettings(): Promise<PublicMicrosoftTodoSettings>
  updateMicrosoftTodoClientId(clientId: string): Promise<MicrosoftTodoSettingsResult>
  beginMicrosoftTodoConnect(): Promise<MicrosoftTodoSettingsResult>
  getMicrosoftTodoConnectStatus(): Promise<MicrosoftTodoConnectStatusResult>
  cancelMicrosoftTodoConnect(): Promise<MicrosoftTodoConnectStatusResult>
  disconnectMicrosoftTodo(): Promise<MicrosoftTodoSettingsResult>
  listMicrosoftTodoTaskLists(pageToken?: string): Promise<MicrosoftTodoTaskListsReadResult>
  listMicrosoftTodoTasks(taskListId: string, pageToken?: string): Promise<MicrosoftTodoTasksReadResult>

  getMicrosoftCalendarSettings(): Promise<PublicMicrosoftCalendarSettings>
  updateMicrosoftCalendarClientId(clientId: string): Promise<MicrosoftCalendarSettingsResult>
  beginMicrosoftCalendarConnect(): Promise<MicrosoftCalendarSettingsResult>
  getMicrosoftCalendarConnectStatus(): Promise<MicrosoftCalendarConnectStatusResult>
  cancelMicrosoftCalendarConnect(): Promise<MicrosoftCalendarConnectStatusResult>
  disconnectMicrosoftCalendar(): Promise<MicrosoftCalendarSettingsResult>
  listMicrosoftCalendarEvents(startDateTime?: string, endDateTime?: string, pageToken?: string): Promise<MicrosoftCalendarEventsReadResult>
  createCalendarPrepTask(input: CalendarPrepTaskInput): Promise<TodayTaskExportActionResult>
  createEmailFollowupTask(input: EmailFollowupTaskInput): Promise<TodayTaskExportActionResult>

  getMicrosoftMailSettings(): Promise<PublicMicrosoftMailSettings>
  updateMicrosoftMailClientId(clientId: string): Promise<MicrosoftMailSettingsResult>
  beginMicrosoftMailConnect(): Promise<MicrosoftMailSettingsResult>
  getMicrosoftMailConnectStatus(): Promise<MicrosoftMailConnectStatusResult>
  cancelMicrosoftMailConnect(): Promise<MicrosoftMailConnectStatusResult>
  disconnectMicrosoftMail(): Promise<MicrosoftMailSettingsResult>
  searchMicrosoftMail(query: string, pageToken?: string): Promise<MicrosoftMailSearchResult>
  readMicrosoftMailMessage(messageId: string): Promise<MicrosoftMailReadResult>

  onEvent(listener: (event: AssistEvent) => void): () => void
}
