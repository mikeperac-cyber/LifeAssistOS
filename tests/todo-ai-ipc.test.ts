import { describe, expect, it, vi } from 'vitest'
import type { IpcMain } from 'electron'
import type { Provider, ChatRequest, ChatResponse } from '../src/core/providers/types'
import type { ProviderSettings } from '../src/shared/types'
import { DEFAULT_PROVIDER_SETTINGS } from '../src/core/settings'
import { registerTodoAiIpcHandlers, type TodoAiIpcContext } from '../src/main/ipc/todo-ai-handlers'
import { ProviderRequestGate } from '../src/main/ipc/provider-request-gate'

type Handler = (...args: any[]) => Promise<unknown> | unknown

function createIpcHarness(): { ipcMain: IpcMain; handlers: Map<string, Handler> } {
  const handlers = new Map<string, Handler>()
  const ipcMain = {
    handle(channel: string, handler: Handler) { handlers.set(channel, handler); return ipcMain }
  } as unknown as IpcMain
  return { ipcMain, handlers }
}

function providerWithResponse(responseText: string): Provider & { chat: ReturnType<typeof vi.fn> } {
  return {
    name: 'test-provider',
    chat: vi.fn(async (_request: ChatRequest): Promise<ChatResponse> => ({ text: responseText, toolCalls: [], finishReason: 'stop' })),
    listModels: vi.fn(async () => [])
  }
}

function makeContext(provider: ProviderSettings | null, createProvider: TodoAiIpcContext['createProvider']): TodoAiIpcContext {
  const harness = createIpcHarness()
  const context: TodoAiIpcContext = { ipcMain: harness.ipcMain, getProviderSettings: () => provider, createProvider, requestGate: new ProviderRequestGate() }
  registerTodoAiIpcHandlers(context)
  return Object.assign(context, { handlers: harness.handlers })
}

describe('todo AI IPC', () => {
  it('test_ai_ipc_uses_current_provider_and_returns_no_secret', async () => {
    const secret = 'api-key-that-must-never-cross-ipc'
    const config: ProviderSettings = { ...DEFAULT_PROVIDER_SETTINGS, preset: 'openai', apiKey: secret }
    const suggestion = {
      title: 'Send the proposal',
      notes: '',
      dueDate: null,
      remindAt: null,
      priority: 'normal'
    }
    const provider = providerWithResponse(JSON.stringify(suggestion))
    const createProvider = vi.fn(() => provider)
    const context = makeContext(config, createProvider) as TodoAiIpcContext & { handlers: Map<string, Handler> }
    const handler = context.handlers.get('assist:todo-ai-draft')

    const result = await handler?.({}, 'Send the proposal tomorrow', { localDate: '2026-11-08', timeZone: 'Europe/Istanbul' })

    expect(result).toEqual({ ok: true, suggestion })
    expect(createProvider).toHaveBeenCalledWith(config, 'fast')
    expect(provider.chat).toHaveBeenCalledTimes(1)
    expect(provider.chat.mock.calls[0][0].tools).toBeUndefined()
    expect(JSON.stringify(result)).not.toContain(secret)
    expect(Object.keys(result as object)).toEqual(['ok', 'suggestion'])
  })

  it('returns a setup-required error for a hosted provider with no API key', async () => {
    const config: ProviderSettings = { ...DEFAULT_PROVIDER_SETTINGS, preset: 'openai', apiKey: undefined }
    const createProvider = vi.fn(() => providerWithResponse('{}'))
    const context = makeContext(config, createProvider) as TodoAiIpcContext & { handlers: Map<string, Handler> }
    const handler = context.handlers.get('assist:todo-ai-draft')

    const result = await handler?.({}, 'Make a task', { localDate: '2026-11-08', timeZone: 'Europe/Istanbul' })

    expect(result).toEqual({ ok: false, error: 'Add your provider API key in Settings to use AI task suggestions.' })
    expect(createProvider).not.toHaveBeenCalled()
  })

  it('returns a safe error when the provider error includes credential text', async () => {
    const secret = 'leaked-key-value'
    const config: ProviderSettings = { ...DEFAULT_PROVIDER_SETTINGS, preset: 'openai', apiKey: secret }
    const provider = providerWithResponse('{}')
    provider.chat.mockRejectedValueOnce(new Error(`Provider rejected ${secret}`))
    const context = makeContext(config, () => provider) as TodoAiIpcContext & { handlers: Map<string, Handler> }
    const handler = context.handlers.get('assist:todo-ai-draft')

    const result = await handler?.({}, 'Make a task', { localDate: '2026-11-08', timeZone: 'Europe/Istanbul' })

    expect(result).toEqual({ ok: false, error: 'AI task suggestions are unavailable. Check Settings and try again.' })
    expect(JSON.stringify(result)).not.toContain(secret)
  })
})
