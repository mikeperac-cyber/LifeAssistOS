import { describe, expect, it, vi } from 'vitest'
import type { IpcMain } from 'electron'
import { ProviderError, type Provider, type ChatRequest, type ChatResponse } from '../src/core/providers/types'
import { DEFAULT_PROVIDER_SETTINGS } from '../src/core/settings'
import { registerAssistantIpcHandlers, type AssistantIpcContext } from '../src/main/ipc/assistant-handlers'
import { ProviderRequestGate } from '../src/main/ipc/provider-request-gate'
import type { PlanTask } from '../src/shared/types'

type Handler = (...args: any[]) => Promise<unknown> | unknown

function setup(gate = new ProviderRequestGate()): { handler: Handler; cancelHandler: Handler; chat: ReturnType<typeof vi.fn>; sendDelta: ReturnType<typeof vi.fn> } {
  const handlers = new Map<string, Handler>()
  const ipcMain = {
    handle(channel: string, listener: Handler) { handlers.set(channel, listener) }
  } as unknown as IpcMain
  const secret = 'renderer-must-never-receive-this-key'
  const chat = vi.fn(async (_request: ChatRequest): Promise<ChatResponse> => ({ text: 'Let’s choose one manageable step.', toolCalls: [], finishReason: 'stop' }))
  const sendDelta = vi.fn()
  const provider: Provider = { name: 'test', chat, listModels: vi.fn(async () => []) }
  const context: AssistantIpcContext = {
    ipcMain,
    sendDelta: (_event, requestId, text) => sendDelta({ requestId, text }),
    getProviderSettings: () => ({ ...DEFAULT_PROVIDER_SETTINGS, apiKey: secret }),
    getTasks: () => [{ id: 'task-1', title: 'Prepare lesson', dueDate: '2026-11-11', priority: 'high', status: 'open', privateNote: 'must not be shared' } as unknown as PlanTask],
    createProvider: () => provider,
    requestGate: gate
  }
  registerAssistantIpcHandlers(context)
  return { handler: handlers.get('assist:assistant-chat')!, cancelHandler: handlers.get('assist:assistant-chat-cancel')!, chat, sendDelta }
}

const request = {
  requestId: '550e8400-e29b-41d4-a716-446655440000',
  mode: 'coach',
  messages: [{ role: 'user', content: 'Help me choose a priority.' }],
  includeTasks: false,
  localDate: '2026-11-10',
  timeZone: 'Europe/Istanbul'
}

describe('assistant chat IPC', () => {
  it('keeps task context out of provider requests unless the user opts in', async () => {
    const { handler, chat } = setup()
    const result = await handler({}, request)

    expect(result).toEqual({ ok: true, reply: 'Let’s choose one manageable step.' })
    const sent = chat.mock.calls[0][0] as ChatRequest
    expect(sent.messages.some((message) => message.content.includes('Prepare lesson'))).toBe(false)
    expect(JSON.stringify(result)).not.toContain('renderer-must-never-receive-this-key')
  })

  it('shares only selected task titles, dates, and priorities when opted in', async () => {
    const { handler, chat } = setup()
    await handler({}, { ...request, includeTasks: true })

    const sent = chat.mock.calls[0][0] as ChatRequest
    const taskContext = sent.messages.find((message) => message.content.includes('sharedTaskContext'))
    expect(taskContext?.content).toContain('Prepare lesson')
    expect(taskContext?.content).toContain('2026-11-11')
    expect(taskContext?.content).not.toContain('privateNote')
    expect(taskContext?.content).not.toContain('must not be shared')
  })

  it('enforces the shared provider request gate before any provider call', async () => {
    const gate = new ProviderRequestGate(1)
    await gate.run(async () => undefined)
    const { handler, chat } = setup(gate)

    expect(await handler({}, request)).toEqual({
      ok: false,
      error: 'You have reached the short AI request limit. Wait a moment and try again.'
    })
    expect(chat).not.toHaveBeenCalled()
  })

  it('rejects malformed payloads before provider construction', async () => {
    const { handler, chat } = setup()

    expect(await handler({}, { ...request, timeZone: 'not/a-zone' })).toEqual({ ok: false, error: 'Enter a message and try again.' })
    expect(chat).not.toHaveBeenCalled()
  })

  it('rejects unsupported learning levels before provider construction', async () => {
    const { handler, chat } = setup()

    expect(await handler({}, { ...request, mode: 'teacher', learningLevel: 'expert' })).toEqual({ ok: false, error: 'Enter a message and try again.' })
    expect(chat).not.toHaveBeenCalled()
  })

  it('forwards bounded provider deltas with the originating request ID', async () => {
    const { handler, chat, sendDelta } = setup()
    chat.mockImplementation(async (providerRequest: ChatRequest): Promise<ChatResponse> => {
      providerRequest.onDelta?.('A helpful partial response.')
      return { text: 'A helpful partial response.', toolCalls: [], finishReason: 'stop' }
    })

    await handler({}, request)

    expect(sendDelta).toHaveBeenCalledWith({ requestId: request.requestId, text: 'A helpful partial response.' })
  })

  it('cancels only the request identified by its validated ID', async () => {
    const { handler, cancelHandler, chat } = setup()
    chat.mockImplementation((providerRequest: ChatRequest) => new Promise<ChatResponse>((_resolve, reject) => {
      providerRequest.signal?.addEventListener('abort', () => reject(new ProviderError('Stopped.', { code: 'aborted' })), { once: true })
    }))

    const result = handler({}, request)
    await vi.waitFor(() => expect(chat).toHaveBeenCalled())
    expect(await cancelHandler({}, 'not-a-request-id')).toBe(false)
    expect(await cancelHandler({}, request.requestId)).toBe(true)
    await expect(result).resolves.toEqual({ ok: false, error: 'Response stopped.' })
    expect(await cancelHandler({}, request.requestId)).toBe(false)
  })
})
