import type { IpcMain } from 'electron'
import type { PlanTask, ProviderSettings } from '../../shared/types'
import type { TodoAiContext, TodoAiResult } from '../../shared/todo-ai'
import { suggestSubtasks, suggestTaskDraft, suggestTodayPlan } from '../../core/todo-ai'
import type { Provider, ProviderErrorCode } from '../../core/providers/types'
import { ProviderError } from '../../core/providers/types'
import type { ProviderModelRole } from '../../core/providers/factory'

type TodayPlanTask = Pick<PlanTask, 'id' | 'title' | 'dueDate' | 'priority'>

export interface TodoAiIpcContext {
  ipcMain: Pick<IpcMain, 'handle'>
  getProviderSettings: () => ProviderSettings | null
  createProvider: (settings: ProviderSettings, role: ProviderModelRole) => Provider
}

const PRIORITIES = new Set(['low', 'normal', 'high'])

export function registerTodoAiIpcHandlers(context: TodoAiIpcContext): void {
  context.ipcMain.handle('assist:todo-ai-draft', async (_event, text: unknown, rawContext: unknown) => {
    if (typeof text !== 'string') return failure('Capture some text before asking AI for a draft.')
    const aiContext = readContext(rawContext)
    if (!aiContext) return failure('A valid local date and time zone are required for AI planning.')
    const ready = getReadyProvider(context)
    if ('error' in ready) return failure(ready.error)
    try {
      return success(await suggestTaskDraft(ready.provider, text, aiContext))
    } catch (error) {
      return failure(safeError(error))
    }
  })

  context.ipcMain.handle('assist:todo-ai-subtasks', async (_event, rawTask: unknown) => {
    const task = readSubtaskInput(rawTask)
    if (!task) return failure('Choose a valid task before asking AI for subtasks.')
    const ready = getReadyProvider(context)
    if ('error' in ready) return failure(ready.error)
    try {
      return success(await suggestSubtasks(ready.provider, task))
    } catch (error) {
      return failure(safeError(error))
    }
  })

  context.ipcMain.handle('assist:todo-ai-plan', async (_event, rawTasks: unknown, rawContext: unknown) => {
    const tasks = readPlanTasks(rawTasks)
    if (!tasks) return failure('Choose up to 30 valid tasks before asking AI to plan today.')
    const aiContext = readContext(rawContext)
    if (!aiContext) return failure('A valid local date and time zone are required for AI planning.')
    const ready = getReadyProvider(context)
    if ('error' in ready) return failure(ready.error)
    try {
      return success(await suggestTodayPlan(ready.provider, tasks, aiContext))
    } catch (error) {
      return failure(safeError(error))
    }
  })
}

function getReadyProvider(context: TodoAiIpcContext): { provider: Provider } | { error: string } {
  const settings = context.getProviderSettings()
  if (!settings) return { error: 'Mike Assist is still starting. Try again in a moment.' }
  if (requiresApiKey(settings) && !settings.apiKey?.trim()) {
    return { error: 'Add your provider API key in Settings to use AI task suggestions.' }
  }
  try {
    return { provider: context.createProvider(settings, 'fast') }
  } catch {
    return { error: 'AI task suggestions are unavailable. Check Settings and try again.' }
  }
}

function requiresApiKey(settings: ProviderSettings): boolean {
  if (settings.preset === 'ollama' || settings.preset === 'lmstudio') return false
  try {
    const hostname = new URL(settings.baseUrl).hostname.toLowerCase().replace(/^\[|\]$/g, '')
    return hostname !== 'localhost' && !hostname.endsWith('.localhost') && hostname !== '127.0.0.1' && hostname !== '::1'
  } catch {
    return true
  }
}

function readContext(value: unknown): TodoAiContext | null {
  if (!value || typeof value !== 'object') return null
  const input = value as { localDate?: unknown; timeZone?: unknown }
  if (typeof input.localDate !== 'string' || typeof input.timeZone !== 'string') return null
  return { localDate: input.localDate, timeZone: input.timeZone }
}

function readSubtaskInput(value: unknown): Pick<PlanTask, 'title' | 'notes' | 'dueDate' | 'priority'> | null {
  if (!value || typeof value !== 'object') return null
  const input = value as { title?: unknown; notes?: unknown; dueDate?: unknown; priority?: unknown }
  if (typeof input.title !== 'string' || typeof input.notes !== 'string' ||
    (input.dueDate !== null && typeof input.dueDate !== 'string') ||
    typeof input.priority !== 'string' || !PRIORITIES.has(input.priority)) return null
  return { title: input.title, notes: input.notes, dueDate: input.dueDate, priority: input.priority as PlanTask['priority'] }
}

function readPlanTasks(value: unknown): TodayPlanTask[] | null {
  if (!Array.isArray(value) || value.length > 30) return null
  const tasks: TodayPlanTask[] = []
  for (const item of value) {
    if (!item || typeof item !== 'object') return null
    const task = item as { id?: unknown; title?: unknown; dueDate?: unknown; priority?: unknown }
    if (typeof task.id !== 'string' || !task.id.trim() || typeof task.title !== 'string' ||
      (task.dueDate !== null && typeof task.dueDate !== 'string') ||
      typeof task.priority !== 'string' || !PRIORITIES.has(task.priority)) return null
    tasks.push({
      id: task.id,
      title: task.title,
      dueDate: task.dueDate,
      priority: task.priority as PlanTask['priority']
    })
  }
  return tasks
}

function success<T>(suggestion: T): TodoAiResult<T> {
  return { ok: true, suggestion }
}

function failure(error: string): TodoAiResult<never> {
  return { ok: false, error }
}

const SAFE_CORE_ERRORS = new Set([
  'Capture text must be 2,000 characters or fewer.',
  'Daily planning supports up to 30 tasks at a time.',
  'Daily planning requires unique task IDs.',
  'The AI returned an invalid task ID. Try again.',
  'The AI returned a task ID that was not in the planning request.',
  'The AI returned task rationales that do not match its proposed plan.',
  'The AI returned invalid JSON. Try again.',
  'The AI response did not match the expected task format. Try again.',
  'A valid local date and time zone are required for AI planning.'
])

function safeError(error: unknown): string {
  if (error instanceof ProviderError) return safeProviderError(error.code)
  if (error instanceof Error && SAFE_CORE_ERRORS.has(error.message)) return error.message
  return 'AI task suggestions are unavailable. Check Settings and try again.'
}

function safeProviderError(code: ProviderErrorCode): string {
  switch (code) {
    case 'aborted': return 'AI suggestion cancelled.'
    case 'timeout': return 'The AI provider took too long to respond. Try again.'
    case 'auth': return 'The provider rejected its API key. Check Settings.'
    case 'rate_limit': return 'The provider is busy. Wait a moment and try again.'
    case 'server': return 'The provider returned an error. Try again later.'
    case 'bad_response': return 'The provider returned a response Mike Assist could not read.'
    case 'tools_unsupported': return 'The selected provider model could not complete this request.'
    case 'not_found': return 'Check the provider endpoint in Settings.'
    case 'network': return 'Could not reach the AI provider. Check the connection and try again.'
  }
}
