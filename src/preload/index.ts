import { contextBridge, ipcRenderer } from 'electron'
import type { IpcRendererEvent } from 'electron'
import type { AssistApi, SettingsPatch } from '../shared/ipc'
import type { ApprovalChoice, AssistantSkillInput, MemoryFactPatch, McpServerInput } from '../shared/types'
import type { AssistEvent } from '../shared/types'

const api: AssistApi = {
  sendMessage: (text, mode, attachments) => ipcRenderer.invoke('assist:send', text, mode, attachments),
  cancel: () => ipcRenderer.invoke('assist:cancel'),
  respondPermission: (requestId: string, choice: ApprovalChoice) =>
    ipcRenderer.invoke('assist:permission-response', { requestId, choice }),
  getAudit: () => ipcRenderer.invoke('assist:audit'),
  getAuditIntegrity: () => ipcRenderer.invoke('assist:audit-integrity'),
  exportAudit: () => ipcRenderer.invoke('assist:audit-export'),
  getChatState: () => ipcRenderer.invoke('assist:chat-state'),
  createChat: () => ipcRenderer.invoke('assist:chat-new'),
  switchChat: (sessionId: string) => ipcRenderer.invoke('assist:chat-switch', sessionId),
  renameChat: (sessionId: string, title: string) =>
    ipcRenderer.invoke('assist:chat-rename', { sessionId, title }),
  deleteChat: (sessionId: string) => ipcRenderer.invoke('assist:chat-delete', sessionId),
  deleteChatMessage: (sessionId: string, messageId: string) =>
    ipcRenderer.invoke('assist:chat-message-delete', { sessionId, messageId }),
  exportChat: (sessionId: string) => ipcRenderer.invoke('assist:chat-export', sessionId),
  searchChats: (query: string, mode?: string) =>
    ipcRenderer.invoke('assist:chat-search', { query, mode }),

  getGrants: () => ipcRenderer.invoke('assist:grants'),
  addGrant: (access: 'read' | 'read-write') => ipcRenderer.invoke('assist:grant-add', access),
  removeGrant: (id: string) => ipcRenderer.invoke('assist:grant-remove', id),
  setGrantAccess: (id: string, access: 'read' | 'read-write') =>
    ipcRenderer.invoke('assist:grant-access', { id, access }),
  getAllowedDomains: () => ipcRenderer.invoke('assist:domains'),
  addAllowedDomain: (host: string) => ipcRenderer.invoke('assist:domain-add', host),
  removeAllowedDomain: (host: string) => ipcRenderer.invoke('assist:domain-remove', host),
  createBackup: (passphrase?: string) => ipcRenderer.invoke('assist:backup', passphrase),
  restoreBackup: (passphrase?: string) => ipcRenderer.invoke('assist:backup-restore', passphrase),
  getSpeechEndpoint: () => ipcRenderer.invoke('assist:speech-endpoint'),
  updateSpeechEndpoint: (endpoint: string) => ipcRenderer.invoke('assist:speech-update', endpoint),
  transcribeAudio: (audio: Uint8Array, mimeType: string) =>
    ipcRenderer.invoke('assist:transcribe-audio', audio, mimeType),
  completeOnboarding: () => ipcRenderer.invoke('assist:onboarding-complete'),
  getFinanceReport: (period: 'week' | 'month') => ipcRenderer.invoke('assist:finance-report', period),
  recordFinanceTransaction: (input) => ipcRenderer.invoke('assist:finance-add', input),
  exportFinanceCsv: () => ipcRenderer.invoke('assist:finance-export-csv'),
  importFinanceCsv: () => ipcRenderer.invoke('assist:finance-import-csv'),
  getWorkflows: () => ipcRenderer.invoke('assist:workflows'),
  saveWorkflow: (input) => ipcRenderer.invoke('assist:workflow-save', input),
  removeWorkflow: (id: string) => ipcRenderer.invoke('assist:workflow-remove', id),
  runWorkflow: (id: string, params?: Record<string, string>) => ipcRenderer.invoke('assist:workflow-run', { id, params }),
  getScheduledTasks: () => ipcRenderer.invoke('assist:scheduled-tasks'),
  getScheduledTaskRuns: (taskId?: string) => ipcRenderer.invoke('assist:scheduled-runs', taskId),
  createScheduledTask: (input) => ipcRenderer.invoke('assist:scheduled-create', input),
  setScheduledTaskEnabled: (id: string, enabled: boolean) => ipcRenderer.invoke('assist:scheduled-enabled', { id, enabled }),
  removeScheduledTask: (id: string) => ipcRenderer.invoke('assist:scheduled-remove', id),
  runScheduledTask: (id: string) => ipcRenderer.invoke('assist:scheduled-run', id),

  getSkills: () => ipcRenderer.invoke('assist:skills'),
  saveSkill: (input: AssistantSkillInput) => ipcRenderer.invoke('assist:skill-save', input),
  setSkillEnabled: (id: string, enabled: boolean) => ipcRenderer.invoke('assist:skill-enabled', { id, enabled }),
  deleteSkill: (id: string) => ipcRenderer.invoke('assist:skill-delete', id),

  getMemory: (query?: string) => ipcRenderer.invoke('assist:memory-list', query),
  addMemory: (input) => ipcRenderer.invoke('assist:memory-add', input),
  updateMemory: (id: string, patch: MemoryFactPatch) => ipcRenderer.invoke('assist:memory-update', { id, patch }),
  archiveMemory: (id: string) => ipcRenderer.invoke('assist:memory-archive', id),
  deleteMemory: (id: string) => ipcRenderer.invoke('assist:memory-delete', id),
  recallMemory: (query: string, limit?: number) => ipcRenderer.invoke('assist:memory-recall', query, limit),

  getMcpServers: () => ipcRenderer.invoke('assist:mcp-servers'),
  addMcpServer: (input) => ipcRenderer.invoke('assist:mcp-add', input),
  updateMcpServer: (id: string, patch: Partial<McpServerInput>) => ipcRenderer.invoke('assist:mcp-update', { id, patch }),
  removeMcpServer: (id: string) => ipcRenderer.invoke('assist:mcp-remove', id),
  refreshMcpServer: (id: string) => ipcRenderer.invoke('assist:mcp-refresh', id),
  importMcpConfig: (text: string) => ipcRenderer.invoke('assist:mcp-import', text),

  getResearchProjects: (includeArchived?: boolean) => ipcRenderer.invoke('assist:research-projects', includeArchived),
  createResearchProject: (input) => ipcRenderer.invoke('assist:research-project-create', input),
  archiveResearchProject: (id: string) => ipcRenderer.invoke('assist:research-project-archive', id),
  removeResearchProject: (id: string) => ipcRenderer.invoke('assist:research-project-remove', id),
  addResearchSource: (input) => ipcRenderer.invoke('assist:research-source-add', input),
  removeResearchSource: (id: string) => ipcRenderer.invoke('assist:research-source-remove', id),

  getVaultDocuments: (query?: string) => ipcRenderer.invoke('assist:vault-search', query),
  createVaultDocument: (input) => ipcRenderer.invoke('assist:vault-create', input),
  updateVaultDocument: (id: string, patch) => ipcRenderer.invoke('assist:vault-update', { id, patch }),
  deleteVaultDocument: (id: string) => ipcRenderer.invoke('assist:vault-delete', id),

  getToday: (date?: string) => ipcRenderer.invoke('assist:today', date),
  getPlanTasks: (includeCompleted?: boolean) => ipcRenderer.invoke('assist:plan-tasks', includeCompleted),
  addPlanTask: (input) => ipcRenderer.invoke('assist:plan-task-add', input),
  updatePlanTask: (id: string, patch) => ipcRenderer.invoke('assist:plan-task-update', { id, patch }),
  captureInbox: (text: string) => ipcRenderer.invoke('assist:inbox-capture', text),
  convertInbox: (id: string, input) => ipcRenderer.invoke('assist:inbox-convert', { id, input }),
  dismissInbox: (id: string) => ipcRenderer.invoke('assist:inbox-dismiss', id),

  getCoachingContext: () => ipcRenderer.invoke('assist:coaching-context'),
  updateCoachingProfile: (patch) => ipcRenderer.invoke('assist:coaching-profile-update', patch),
  createCoachingGoal: (input) => ipcRenderer.invoke('assist:coaching-goal-create', input),
  updateCoachingGoal: (id: string, patch) => ipcRenderer.invoke('assist:coaching-goal-update', { id, patch }),
  saveCoachingJournal: (input) => ipcRenderer.invoke('assist:coaching-journal-save', input),
  getCoachingJournal: (area) => ipcRenderer.invoke('assist:coaching-journal', area),

  getSettings: () => ipcRenderer.invoke('assist:settings'),
  updateSettings: (patch: SettingsPatch) => ipcRenderer.invoke('assist:settings-update', patch),
  getLocalApiStatus: () => ipcRenderer.invoke('assist:local-api-status'),
  setLocalApiEnabled: (enabled: boolean) => ipcRenderer.invoke('assist:local-api-enable', enabled),
  testProvider: () => ipcRenderer.invoke('assist:provider-test'),
  getWebSearchSettings: () => ipcRenderer.invoke('assist:web-search-settings'),
  updateWebSearchApiKey: (apiKey: string | null) => ipcRenderer.invoke('assist:web-search-settings-update', apiKey),
  getGoogleCalendarSettings: () => ipcRenderer.invoke('assist:google-calendar-settings'),
  updateGoogleCalendarClientId: (clientId: string) => ipcRenderer.invoke('assist:google-calendar-client-id-update', clientId),
  connectGoogleCalendar: () => ipcRenderer.invoke('assist:google-calendar-connect'),
  disconnectGoogleCalendar: () => ipcRenderer.invoke('assist:google-calendar-disconnect'),
  getGoogleGmailSettings: () => ipcRenderer.invoke('assist:google-gmail-settings'),
  updateGoogleGmailClientId: (clientId: string) => ipcRenderer.invoke('assist:google-gmail-client-id-update', clientId),
  connectGoogleGmail: () => ipcRenderer.invoke('assist:google-gmail-connect'),
  disconnectGoogleGmail: () => ipcRenderer.invoke('assist:google-gmail-disconnect'),
  getGoogleDriveSettings: () => ipcRenderer.invoke('assist:google-drive-settings'),
  updateGoogleDriveClientId: (clientId: string) => ipcRenderer.invoke('assist:google-drive-client-id-update', clientId),
  connectGoogleDrive: () => ipcRenderer.invoke('assist:google-drive-connect'),
  disconnectGoogleDrive: () => ipcRenderer.invoke('assist:google-drive-disconnect'),
  getGoogleTasksSettings: () => ipcRenderer.invoke('assist:google-tasks-settings'),
  updateGoogleTasksClientId: (clientId: string) => ipcRenderer.invoke('assist:google-tasks-client-id-update', clientId),
  connectGoogleTasks: () => ipcRenderer.invoke('assist:google-tasks-connect'),
  disconnectGoogleTasks: () => ipcRenderer.invoke('assist:google-tasks-disconnect'),
  listGoogleTaskLists: (pageToken?: string) => ipcRenderer.invoke('assist:google-tasks-list-lists', pageToken),
  listGoogleTasks: (taskListId: string, pageToken?: string) => ipcRenderer.invoke('assist:google-tasks-list-tasks', taskListId, pageToken),

  onEvent: (listener: (event: AssistEvent) => void) => {
    const wrapped = (_event: IpcRendererEvent, payload: AssistEvent): void => listener(payload)
    ipcRenderer.on('assist:event', wrapped)
    return () => {
      ipcRenderer.removeListener('assist:event', wrapped)
    }
  }
}

contextBridge.exposeInMainWorld('assist', api)
