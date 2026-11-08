/* Focused task and provider contracts shared by Electron and the renderer. */

export type PlanTaskStatus = 'open' | 'done' | 'cancelled'
export type PlanTaskPriority = 'low' | 'normal' | 'high'

export interface PlanTask {
  id: string
  title: string
  notes: string
  dueDate: string | null
  /** Local one-time reminder instant stored as canonical UTC ISO-8601. */
  remindAt: string | null
  priority: PlanTaskPriority
  status: PlanTaskStatus
  createdAt: string
  updatedAt: string
  completedAt: string | null
  parentTaskId: string | null
  sourceInboxId?: string
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
