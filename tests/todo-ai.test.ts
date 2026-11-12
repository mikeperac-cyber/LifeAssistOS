import { describe, expect, it, vi } from 'vitest'
import type { Provider, ChatRequest, ChatResponse } from '../src/core/providers/types'
import type { PlanTask } from '../src/shared/types'
import { suggestSubtasks, suggestTaskDraft, suggestTodayPlan } from '../src/core/todo-ai'

function makeProvider(responseText: string): Provider & { chat: ReturnType<typeof vi.fn> } {
  return {
    name: 'test',
    chat: vi.fn(async (_request: ChatRequest): Promise<ChatResponse> => ({
      text: responseText,
      toolCalls: [],
      finishReason: 'stop'
    })),
    listModels: vi.fn(async () => [])
  }
}

function makeTask(overrides: Partial<PlanTask> = {}): PlanTask {
  return {
    id: 'task-1',
    title: 'Prepare launch',
    notes: 'Do not include these notes in the daily plan request.',
    dueDate: '2026-11-10',
    remindAt: null,
    priority: 'high',
    status: 'open',
    createdAt: '2026-11-08T08:00:00.000Z',
    updatedAt: '2026-11-08T08:00:00.000Z',
    completedAt: null,
    parentTaskId: null,
    recurrenceRule: null,
    recurrenceDate: null,
    recurrenceSeriesId: null,
    ...overrides
  }
}

describe('todo AI suggestions', () => {
  it('uses the supplied local date and timezone when resolving a task draft', async () => {
    const provider = makeProvider(JSON.stringify({
      title: 'Send the proposal',
      notes: 'Include revised pricing.',
      dueDate: '2026-11-10',
      remindAt: '2026-11-10T06:00:00.000Z',
      priority: 'high'
    }))

    const suggestion = await suggestTaskDraft(provider, 'Send the proposal on Tuesday morning', {
      localDate: '2026-11-08',
      timeZone: 'Europe/Istanbul'
    })

    expect(suggestion).toEqual({
      title: 'Send the proposal',
      notes: 'Include revised pricing.',
      dueDate: '2026-11-10',
      remindAt: '2026-11-10T06:00:00.000Z',
      priority: 'high'
    })
    const request = provider.chat.mock.calls[0][0] as ChatRequest
    expect(request.messages).toHaveLength(2)
    expect(request.messages.map((message) => message.role)).toEqual(['system', 'user'])
    expect(request.messages[1].content).toContain('2026-11-08')
    expect(request.messages[1].content).toContain('Europe/Istanbul')
    expect(request.tools).toBeUndefined()
  })

  it('rejects invalid AI JSON without returning a partial suggestion', async () => {
    const provider = makeProvider('{"title":')

    await expect(suggestTaskDraft(provider, 'Call the dentist', {
      localDate: '2026-11-08',
      timeZone: 'Europe/Istanbul'
    })).rejects.toThrow()
  })

  it('rejects capture text over 2,000 characters before contacting the provider', async () => {
    const provider = makeProvider('{}')

    await expect(suggestTaskDraft(provider, 'x'.repeat(2001), {
      localDate: '2026-11-08',
      timeZone: 'Europe/Istanbul'
    })).rejects.toThrow(/2,000/)
    expect(provider.chat).not.toHaveBeenCalled()
  })

  it('returns at most eight validated subtasks', async () => {
    const suggestions = Array.from({ length: 8 }, (_, index) => ({ title: `Step ${index + 1}`, notes: '' }))
    const provider = makeProvider(JSON.stringify({ subtasks: suggestions }))

    await expect(suggestSubtasks(provider, makeTask())).resolves.toEqual(suggestions)
    expect(provider.chat.mock.calls[0][0].tools).toBeUndefined()

    const tooMany = makeProvider(JSON.stringify({ subtasks: [...suggestions, { title: 'Step 9', notes: '' }] }))
    await expect(suggestSubtasks(tooMany, makeTask())).rejects.toThrow()
  })

  it('limits daily planning to 30 tasks and sends only task IDs, titles, due dates, and priorities', async () => {
    const first = makeTask({ id: 'task-1', title: 'Prepare launch' })
    const second = makeTask({ id: 'task-2', title: 'Book a room', notes: 'Private details', priority: 'normal' })
    const provider = makeProvider(JSON.stringify({
      taskIds: ['task-2', 'task-1'],
      rationaleByTaskId: { 'task-2': 'Clear a dependency.', 'task-1': 'It has the closest deadline.' }
    }))

    await expect(suggestTodayPlan(provider, [first, second], {
      localDate: '2026-11-08',
      timeZone: 'Europe/Istanbul'
    })).resolves.toEqual({
      taskIds: ['task-2', 'task-1'],
      rationaleByTaskId: { 'task-2': 'Clear a dependency.', 'task-1': 'It has the closest deadline.' }
    })

    const request = provider.chat.mock.calls[0][0]
    expect(request.tools).toBeUndefined()
    expect(request.messages[1].content).toContain('2026-11-08')
    expect(request.messages[1].content).toContain('Europe/Istanbul')
    expect(request.messages[1].content).not.toContain('Private details')
    expect(request.messages[1].content).not.toContain('Do not include these notes')
    expect(request.messages[1].content).toContain(JSON.stringify([
      { id: 'task-1', title: 'Prepare launch', dueDate: '2026-11-10', priority: 'high' },
      { id: 'task-2', title: 'Book a room', dueDate: '2026-11-10', priority: 'normal' }
    ]))
  })

  it('rejects unknown or duplicate task IDs in a daily plan', async () => {
    const task = makeTask()
    const context = { localDate: '2026-11-08', timeZone: 'Europe/Istanbul' }
    const unknown = makeProvider(JSON.stringify({ taskIds: ['other'], rationaleByTaskId: { other: 'Because.' } }))
    await expect(suggestTodayPlan(unknown, [task], context)).rejects.toThrow()

    const duplicate = makeProvider(JSON.stringify({ taskIds: ['task-1', 'task-1'], rationaleByTaskId: { 'task-1': 'Because.' } }))
    await expect(suggestTodayPlan(duplicate, [task], context)).rejects.toThrow()
  })

  it('rejects daily planning requests with more than 30 tasks', async () => {
    const provider = makeProvider('{"taskIds":[],"rationaleByTaskId":{}}')
    const tasks = Array.from({ length: 31 }, (_, index) => makeTask({ id: `task-${index}` }))

    await expect(suggestTodayPlan(provider, tasks, {
      localDate: '2026-11-08',
      timeZone: 'Europe/Istanbul'
    })).rejects.toThrow(/30/)
    expect(provider.chat).not.toHaveBeenCalled()
  })

  it('rejects malformed dates in a task draft', async () => {
    const provider = makeProvider(JSON.stringify({
      title: 'File taxes',
      notes: '',
      dueDate: 'next Tuesday',
      remindAt: null,
      priority: 'normal'
    }))

    await expect(suggestTaskDraft(provider, 'File taxes next Tuesday', {
      localDate: '2026-11-08',
      timeZone: 'Europe/Istanbul'
    })).rejects.toThrow()
  })

  it('rejects impossible calendar dates and times in reminders', async () => {
    const provider = makeProvider(JSON.stringify({
      title: 'Call the dentist',
      notes: '',
      dueDate: null,
      remindAt: '2026-02-31T29:15:00.000Z',
      priority: 'normal'
    }))

    await expect(suggestTaskDraft(provider, 'Call the dentist', {
      localDate: '2026-11-08',
      timeZone: 'Europe/Istanbul'
    })).rejects.toThrow()
  })
})
