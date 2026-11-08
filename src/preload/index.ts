import { contextBridge, ipcRenderer } from 'electron'
import type { IpcRendererEvent } from 'electron'
import type { AssistApi } from '../shared/ipc'
import type { AssistEvent } from '../shared/types'

const api: AssistApi = {
  getToday: (date) => ipcRenderer.invoke('assist:today', date),
  getPlanTasks: (includeCompleted) => ipcRenderer.invoke('assist:plan-tasks', includeCompleted),
  addPlanTask: (input) => ipcRenderer.invoke('assist:plan-task-add', input),
  updatePlanTask: (id, patch) => ipcRenderer.invoke('assist:plan-task-update', { id, patch }),
  captureInbox: (text) => ipcRenderer.invoke('assist:inbox-capture', text),
  convertInbox: (id, input) => ipcRenderer.invoke('assist:inbox-convert', { id, input }),
  dismissInbox: (id) => ipcRenderer.invoke('assist:inbox-dismiss', id),

  suggestTaskDraft: (text, context) => ipcRenderer.invoke('assist:todo-ai-draft', text, context),
  suggestTaskSubtasks: (task) => ipcRenderer.invoke('assist:todo-ai-subtasks', task),
  suggestTodayPlan: (tasks, context) => ipcRenderer.invoke('assist:todo-ai-plan', tasks, context),

  createBackup: (passphrase) => ipcRenderer.invoke('assist:backup', passphrase),
  restoreBackup: (passphrase) => ipcRenderer.invoke('assist:backup-restore', passphrase),
  getSettings: () => ipcRenderer.invoke('assist:settings'),
  updateSettings: (patch) => ipcRenderer.invoke('assist:settings-update', patch),
  testProvider: () => ipcRenderer.invoke('assist:provider-test'),

  onEvent: (listener: (event: AssistEvent) => void) => {
    const wrapped = (_event: IpcRendererEvent, payload: AssistEvent): void => listener(payload)
    ipcRenderer.on('assist:event', wrapped)
    return () => ipcRenderer.removeListener('assist:event', wrapped)
  }
}

contextBridge.exposeInMainWorld('assist', api)
