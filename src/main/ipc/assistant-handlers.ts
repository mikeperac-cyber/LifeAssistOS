import type { IpcMain, IpcMainInvokeEvent } from 'electron'
import { z } from 'zod'
import type { AssistantChatRequest, AssistantChatResult } from '../../shared/assistant'
import type { PlanTask } from '../../shared/types'
import { answerAssistantChat } from '../../core/assistant'
import { ProviderError, type Provider } from '../../core/providers/types'
import type { ProviderModelRole } from '../../core/providers/factory'
import type { ProviderSettings } from '../../shared/types'
import { providerRequiresApiKey } from '../../shared/provider-endpoint'
import { ProviderRequestGate, ProviderRequestGateError } from './provider-request-gate'

const requestSchema = z.object({
  requestId: z.string().uuid(),
  mode: z.enum(['coach', 'teacher', 'assistant']),
  messages: z.array(z.object({ role: z.enum(['user', 'assistant']), content: z.string().trim().min(1).max(3_000) }).strict()).min(1).max(8),
  includeTasks: z.boolean(),
  includeGoals: z.boolean().optional().default(false),
  includeJournal: z.boolean().optional().default(false),
  includePersonalContext: z.boolean().optional().default(false),
  learningLevel: z.enum(['adaptive', 'beginner', 'intermediate', 'advanced']).optional(),
  localDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  timeZone: z.string().min(1).max(100)
}).strict().refine((request) => request.messages.at(-1)?.role === 'user', 'The latest message must come from the user.')
  .refine((request) => request.messages.reduce((total, message) => total + message.content.length, 0) <= 12_000, 'The conversation is too long.')
  .refine((request) => isValidTimeZone(request.timeZone), 'A valid time zone is required.')

export interface AssistantIpcContext {
  ipcMain: Pick<IpcMain, 'handle'>
  sendDelta: (event: IpcMainInvokeEvent, requestId: string, text: string) => void
  getProviderSettings: () => ProviderSettings | null
  getTasks: () => PlanTask[]
  getLifeContext?: () => { goals: Array<{ title: string; description: string; status: string; targetDate: string | null }>; journal: Array<{ entryDate: string; title: string; content: string }>; aboutMe: string; preferences: string; currentFocus: string }
  createProvider: (settings: ProviderSettings, role: ProviderModelRole) => Provider
  requestGate: ProviderRequestGate
}

export function registerAssistantIpcHandlers(context: AssistantIpcContext): void {
  const { requestGate } = context
  const activeRequests = new Map<string, AbortController>()
  context.ipcMain.handle('assist:assistant-chat-cancel', (_event, raw: unknown): boolean => {
    const parsed = z.string().uuid().safeParse(raw)
    if (!parsed.success) return false
    const controller = activeRequests.get(parsed.data)
    if (!controller) return false
    controller.abort()
    return true
  })
  context.ipcMain.handle('assist:assistant-chat', async (event, raw: unknown): Promise<AssistantChatResult> => {
    const parsed = requestSchema.safeParse(raw)
    if (!parsed.success) return { ok: false, error: 'Enter a message and try again.' }
    const settings = context.getProviderSettings()
    if (!settings) return { ok: false, error: 'LifeAssistOS is still starting. Try again in a moment.' }
    if (providerRequiresApiKey(settings.preset, settings.baseUrl) && !settings.apiKey?.trim()) {
      return { ok: false, error: 'Connect an AI provider in Settings to start a conversation.' }
    }
    if (activeRequests.has(parsed.data.requestId)) return { ok: false, error: 'This assistant request is already running.' }
    const controller = new AbortController()
    activeRequests.set(parsed.data.requestId, controller)
    try {
      const provider = context.createProvider(settings, 'fast')
      const wantsLifeContext = parsed.data.includeGoals || parsed.data.includeJournal || parsed.data.includePersonalContext
      const reply = await requestGate.run(() => answerAssistantChat(
        provider,
        parsed.data as AssistantChatRequest,
        context.getTasks(),
        {
          signal: controller.signal,
          onDelta: (text) => context.sendDelta(event, parsed.data.requestId, text),
          lifeContext: wantsLifeContext ? context.getLifeContext?.() : undefined
        }
      ))
      return { ok: true, reply }
    } catch (error) {
      if (error instanceof ProviderRequestGateError) return { ok: false, error: error.message }
      return { ok: false, error: error instanceof ProviderError ? safeProviderError(error.code) : 'The assistant could not respond. Check your provider and try again.' }
    } finally {
      if (activeRequests.get(parsed.data.requestId) === controller) activeRequests.delete(parsed.data.requestId)
    }
  })
}

function isValidTimeZone(value: string): boolean {
  try { new Intl.DateTimeFormat('en', { timeZone: value }).format(); return true }
  catch { return false }
}

function safeProviderError(code: ProviderError['code']): string {
  switch (code) {
    case 'aborted': return 'Response stopped.'
    case 'timeout': return 'The provider took too long to respond. Try again.'
    case 'auth': return 'The provider rejected its key. Check Settings.'
    case 'rate_limit': return 'The provider is busy. Wait a moment and try again.'
    case 'server': return 'The provider returned an error. Try again later.'
    case 'bad_response': return 'The provider returned a response LifeAssistOS could not read.'
    case 'tools_unsupported': return 'Choose a model that supports chat responses in Settings.'
    case 'not_found': return 'Check the provider endpoint in Settings.'
    case 'network': return 'Could not reach the provider. Check the connection and try again.'
  }
}
