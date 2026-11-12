import { contextBridge, ipcRenderer } from 'electron'
import type { IpcRendererEvent } from 'electron'
import type { AssistApi } from '../shared/ipc'
import type { AssistantChatDelta } from '../shared/assistant'
import type { AssistEvent } from '../shared/types'

const api: AssistApi = {
  getToday: (date) => ipcRenderer.invoke('assist:today', date),
  getPlanTasks: (includeCompleted) => ipcRenderer.invoke('assist:plan-tasks', includeCompleted),
  getMyDay: (date) => ipcRenderer.invoke('assist:my-day', date),
  planTaskForDay: (id, date) => ipcRenderer.invoke('assist:plan-task-day', { id, date }),
  reorderMyDay: (date, ids) => ipcRenderer.invoke('assist:my-day-reorder', { date, ids }),
  applySuggestedMyDayOrder: (date, ids) => ipcRenderer.invoke('assist:my-day-apply-suggestion', { date, ids }),
  getProjectWorkspace: () => ipcRenderer.invoke('assist:projects-workspace'),
  createArea: (input) => ipcRenderer.invoke('assist:area-create', input),
  deleteArea: (id) => ipcRenderer.invoke('assist:area-delete', id),
  createProject: (input) => ipcRenderer.invoke('assist:project-create', input),
  updateProject: (id, patch) => ipcRenderer.invoke('assist:project-update', { id, patch }),
  deleteProject: (id) => ipcRenderer.invoke('assist:project-delete', id),
  addPlanTask: (input) => ipcRenderer.invoke('assist:plan-task-add', input),
  updatePlanTask: (id, patch) => ipcRenderer.invoke('assist:plan-task-update', { id, patch }),
  skipPlanTaskOccurrence: (id) => ipcRenderer.invoke('assist:plan-task-skip-occurrence', id),
  captureInbox: (text) => ipcRenderer.invoke('assist:inbox-capture', text),
  convertInbox: (id, input) => ipcRenderer.invoke('assist:inbox-convert', { id, input }),
  dismissInbox: (id) => ipcRenderer.invoke('assist:inbox-dismiss', id),

  getLifeWorkspace: () => ipcRenderer.invoke('assist:life-workspace'),
  saveLifeGoal: (input) => ipcRenderer.invoke('assist:life-goal-save', input),
  deleteLifeGoal: (id) => ipcRenderer.invoke('assist:life-goal-delete', id),
  getRoutineTemplates: () => ipcRenderer.invoke('assist:routines'),
  saveRoutineTemplate: (input) => ipcRenderer.invoke('assist:routine-save', input),
  deleteRoutineTemplate: (id) => ipcRenderer.invoke('assist:routine-delete', id),
  applyRoutineTemplate: (id, date) => ipcRenderer.invoke('assist:routine-apply', { id, date }),
  getJournalEntries: (query) => ipcRenderer.invoke('assist:journal-list', query),
  getPinnedJournalEntries: () => ipcRenderer.invoke('assist:journal-pinned-list'),
  saveJournalEntry: (input) => ipcRenderer.invoke('assist:journal-save', input),
  setJournalPinned: (id, isPinned) => ipcRenderer.invoke('assist:journal-pin', { id, isPinned }),
  deleteJournalEntry: (id) => ipcRenderer.invoke('assist:journal-delete', id),
  getPersonalContext: () => ipcRenderer.invoke('assist:personal-context'),
  savePersonalContext: (input) => ipcRenderer.invoke('assist:personal-context-save', input),
  getCalendarSources: () => ipcRenderer.invoke('assist:calendar-sources'),
  getCalendarEvents: (start, end) => ipcRenderer.invoke('assist:calendar-events', { start, end }),
  importCalendar: (sourceId, name, events) => ipcRenderer.invoke('assist:calendar-import', { id: sourceId, name, events }),
  deleteCalendarSource: (id) => ipcRenderer.invoke('assist:calendar-delete', id),

  suggestTaskDraft: (text, context) => ipcRenderer.invoke('assist:todo-ai-draft', text, context),
  suggestTaskSubtasks: (task) => ipcRenderer.invoke('assist:todo-ai-subtasks', task),
  suggestTodayPlan: (tasks, context) => ipcRenderer.invoke('assist:todo-ai-plan', tasks, context),
  assistantChat: (request) => ipcRenderer.invoke('assist:assistant-chat', request),
  cancelAssistantChat: (requestId) => ipcRenderer.invoke('assist:assistant-chat-cancel', requestId),
  onAssistantDelta: (listener) => {
    const wrapped = (_event: IpcRendererEvent, payload: AssistantChatDelta): void => {
      if (payload && typeof payload.requestId === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(payload.requestId) &&
        typeof payload.text === 'string' && payload.text.length > 0 && payload.text.length <= 8_000) listener(payload)
    }
    ipcRenderer.on('assist:assistant-delta', wrapped)
    return () => ipcRenderer.removeListener('assist:assistant-delta', wrapped)
  },

  createBackup: (passphrase) => ipcRenderer.invoke('assist:backup', passphrase),
  restoreBackup: (passphrase) => ipcRenderer.invoke('assist:backup-restore', passphrase),
  getFolderSyncConfig: () => ipcRenderer.invoke('assist:folder-sync-config'),
  chooseFolderSync: () => ipcRenderer.invoke('assist:folder-sync-choose'),
  forgetFolderSyncPassphrase: () => ipcRenderer.invoke('assist:folder-sync-forget-passphrase'),
  syncFolderSync: (passphrase, rememberPassphrase) => ipcRenderer.invoke('assist:folder-sync', { passphrase, rememberPassphrase }),
  getSettings: () => ipcRenderer.invoke('assist:settings'),
  updateSettings: (patch) => ipcRenderer.invoke('assist:settings-update', patch),
  removeProviderCredential: (preset, baseUrl) => ipcRenderer.invoke('assist:provider-credential-remove', { preset, baseUrl }),
  testProvider: () => ipcRenderer.invoke('assist:provider-test'),
  connectOpenRouter: () => ipcRenderer.invoke('assist:openrouter-sign-in'),
  cancelOpenRouterSignIn: () => ipcRenderer.invoke('assist:openrouter-sign-in-cancel'),

  onEvent: (listener: (event: AssistEvent) => void) => {
    const wrapped = (_event: IpcRendererEvent, payload: AssistEvent): void => listener(payload)
    ipcRenderer.on('assist:event', wrapped)
    return () => ipcRenderer.removeListener('assist:event', wrapped)
  }
}

contextBridge.exposeInMainWorld('assist', api)
