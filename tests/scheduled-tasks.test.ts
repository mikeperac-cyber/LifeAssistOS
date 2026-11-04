import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { nextScheduledOccurrence, ScheduledTaskScheduler, ScheduledTaskStore } from '../src/core/scheduled-tasks'

let dir = ''
let file = ''
let store: ScheduledTaskStore

beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'mike-assist-scheduled-'))
  file = path.join(dir, 'scheduled-tasks.json')
  store = new ScheduledTaskStore(file)
  await store.init()
})

afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

describe('scheduled agent tasks', () => {
  it('does not create a task in memory when its save fails', async () => {
    await rm(file)
    await mkdir(file)

    await expect(store.create({
      name: 'Unsaved reminder',
      prompt: 'Review my tasks and suggest one priority.',
      mode: 'assistant',
      schedule: { kind: 'once', at: '2099-01-01T00:00:00.000Z' }
    })).rejects.toBeDefined()

    expect(store.list()).toEqual([])
  })

  it('keeps a scheduled task enabled when saving a disable fails', async () => {
    const task = await store.create({
      name: 'Keep enabled',
      prompt: 'Review my tasks and suggest one priority.',
      mode: 'assistant',
      schedule: { kind: 'daily', time: '08:30' }
    })
    await rm(file)
    await mkdir(file)

    await expect(store.setEnabled(task.id, false)).rejects.toBeDefined()

    expect(store.get(task.id).enabled).toBe(true)
  })

  it('keeps a scheduled task when saving its removal fails', async () => {
    const task = await store.create({
      name: 'Keep stored',
      prompt: 'Review my tasks and suggest one priority.',
      mode: 'assistant',
      schedule: { kind: 'daily', time: '08:30' }
    })
    await rm(file)
    await mkdir(file)

    await expect(store.remove(task.id)).rejects.toBeDefined()

    expect(store.get(task.id).name).toBe('Keep stored')
  })

  it('reports a completed run when saving its history fails', async () => {
    const clock = { value: new Date('2026-11-05T06:00:00.000Z') }
    const task = await store.create({
      name: 'Completed action',
      prompt: 'Review my tasks and suggest one priority.',
      mode: 'assistant',
      schedule: { kind: 'once', at: '2099-01-01T00:00:00.000Z' }
    }, clock.value)
    await rm(file)
    await mkdir(file)
    const changed = vi.fn()
    const scheduler = new ScheduledTaskScheduler(
      store,
      async () => ({ status: 'success', summary: 'One useful task is due today.' }),
      changed,
      10_000,
      () => clock.value
    )
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined)

    const result = await scheduler.runNow(task.id)

    expect(result).toMatchObject({
      ok: true,
      warning: 'The run finished, but its history could not be saved. Its actions may already have taken effect; review them before running it again.',
      task: { runCount: 1, enabled: false }
    })
    expect(store.listRuns(task.id)).toHaveLength(1)
    expect(store.get(task.id).lastError).toBeNull()
    expect(store.list()[0]?.lastError).toContain('actions may already have taken effect')
    expect(changed).toHaveBeenCalledOnce()
    expect(changed.mock.calls[0]?.[2]).toContain('actions may already have taken effect')
    errorSpy.mockRestore()
  })

  it('computes daily and weekday runs in local time', () => {
    const tuesdayMorning = new Date(2026, 10, 3, 7, 0, 0)
    expect(nextScheduledOccurrence({ kind: 'daily', time: '08:30' }, tuesdayMorning))
      .toBe(new Date(2026, 10, 3, 8, 30, 0).toISOString())

    const fridayEvening = new Date(2026, 10, 6, 19, 0, 0)
    expect(nextScheduledOccurrence({ kind: 'weekdays', time: '08:30' }, fridayEvening))
      .toBe(new Date(2026, 10, 9, 8, 30, 0).toISOString())
  })

  it('persists isolated prompt tasks and rejects duplicate or past one-time schedules', async () => {
    const now = new Date(2026, 10, 3, 7, 0, 0)
    const saved = await store.create({
      name: 'Morning plan',
      prompt: 'Review my open tasks and suggest three realistic priorities.',
      mode: 'coach_personal',
      schedule: { kind: 'daily', time: '08:30' }
    }, now)
    expect(saved.nextRunAt).toBe(new Date(2026, 10, 3, 8, 30, 0).toISOString())
    await expect(store.create({
      name: 'morning PLAN',
      prompt: 'Review my open tasks and suggest three priorities.',
      mode: 'coach_personal',
      schedule: { kind: 'daily', time: '08:30' }
    }, now)).rejects.toThrow(/already exists/i)
    await expect(store.create({
      name: 'Missed task',
      prompt: 'Review my goals and give me a helpful summary.',
      mode: 'assistant',
      schedule: { kind: 'once', at: new Date(now.getTime() - 60_000).toISOString() }
    }, now)).rejects.toThrow(/future time/i)

    const reloaded = new ScheduledTaskStore(file)
    await reloaded.init()
    expect(reloaded.get(saved.id)).toEqual(saved)
  })

  it('defers a due task while the agent is busy, then records one result and advances recurrence', async () => {
    const clock = { value: new Date(2026, 10, 3, 10, 0, 0) }
    const task = await store.create({
      name: 'Business review',
      prompt: 'Review recent business goals and list the next useful action.',
      mode: 'coach_business',
      schedule: { kind: 'daily', time: '10:01' }
    }, clock.value)
    const runner = vi.fn()
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ status: 'success', summary: 'One goal is due this week; prepare the next lesson.' })
    const changed = vi.fn()
    const scheduler = new ScheduledTaskScheduler(store, runner, changed, 10_000, () => clock.value)

    clock.value = new Date(2026, 10, 3, 10, 2, 0)
    await scheduler.checkDue()
    expect(store.get(task.id).runCount).toBe(0)
    expect(store.get(task.id).nextRunAt).toBe(task.nextRunAt)

    await scheduler.checkDue()
    expect(store.get(task.id).runCount).toBe(1)
    expect(store.get(task.id).nextRunAt).toBe(new Date(2026, 10, 4, 10, 1, 0).toISOString())
    expect(store.listRuns(task.id)).toHaveLength(1)
    expect(changed).toHaveBeenCalledOnce()
  })

  it('turns off a one-time task after a successful manual run', async () => {
    const clock = { value: new Date(2026, 10, 3, 10, 0, 0) }
    const task = await store.create({
      name: 'One-off follow-up',
      prompt: 'Summarize my goals and suggest one next step.',
      mode: 'coach_personal',
      schedule: { kind: 'once', at: new Date(2026, 10, 3, 11, 0, 0).toISOString() }
    }, clock.value)
    const scheduler = new ScheduledTaskScheduler(
      store,
      async () => ({ status: 'success', summary: 'Choose one small next step today.' }),
      () => undefined,
      10_000,
      () => clock.value
    )

    const result = await scheduler.runNow(task.id)
    expect(result.ok).toBe(true)
    expect(store.get(task.id).enabled).toBe(false)
    expect(store.get(task.id).nextRunAt).toBeNull()
    expect(store.listRuns(task.id)[0].trigger).toBe('manual')
  })

  it('uses one stable run id for the audit journal and persisted history', async () => {
    const task = await store.create({
      name: 'Stable run record',
      prompt: 'Review my tasks and suggest one priority.',
      mode: 'assistant',
      schedule: { kind: 'once', at: '2099-01-01T00:00:00.000Z' }
    })
    let context: { runId: string; startedAt: Date } | undefined
    const scheduler = new ScheduledTaskScheduler(
      store,
      async (_task, _trigger, runContext) => {
        context = runContext
        return { status: 'success', summary: 'A short useful result.' }
      },
      () => undefined
    )

    await scheduler.runNow(task.id)
    expect(context?.runId).toBeTruthy()
    expect(store.listRuns(task.id)[0]?.id).toBe(context?.runId)
    expect(store.listRuns(task.id)[0]?.startedAt).toBe(context?.startedAt.toISOString())
  })

  it('recovers completed runs from the audit journal without storing response text there', async () => {
    const task = await store.create({
      name: 'Recovered one-off',
      prompt: 'Review my tasks and suggest one priority.',
      mode: 'assistant',
      schedule: { kind: 'once', at: '2099-01-01T00:00:00.000Z' }
    }, new Date('2026-11-05T06:00:00.000Z'))
    const startedAt = '2026-11-05T06:01:00.000Z'
    await store.recoverFromAudit([
      {
        id: 'audit-start', at: startedAt, sessionId: 'session', type: 'scheduled_task.started',
        data: { runId: 'stable-run-id', taskId: task.id, trigger: 'scheduled', startedAt }
      },
      {
        id: 'audit-complete', at: '2026-11-05T06:02:00.000Z', sessionId: 'session', type: 'scheduled_task.completed',
        data: { runId: 'stable-run-id', taskId: task.id, trigger: 'scheduled', status: 'success', finishedAt: '2026-11-05T06:02:00.000Z' }
      }
    ], new Date('2026-11-05T07:00:00.000Z'))

    expect(store.listRuns(task.id)).toEqual([expect.objectContaining({
      id: 'stable-run-id', status: 'success', trigger: 'scheduled', startedAt,
      finishedAt: '2026-11-05T06:02:00.000Z',
      summary: expect.stringContaining('detailed response is not available')
    })])
    expect(store.get(task.id)).toMatchObject({ enabled: false, runCount: 1 })
    await store.recoverFromAudit([
      {
        id: 'audit-start', at: startedAt, sessionId: 'session', type: 'scheduled_task.started',
        data: { runId: 'stable-run-id', taskId: task.id, trigger: 'scheduled', startedAt }
      },
      {
        id: 'audit-complete', at: '2026-11-05T06:02:00.000Z', sessionId: 'session', type: 'scheduled_task.completed',
        data: { runId: 'stable-run-id', taskId: task.id, trigger: 'scheduled', status: 'success', finishedAt: '2026-11-05T06:02:00.000Z' }
      }
    ], new Date('2026-11-05T07:00:00.000Z'))
    expect(store.listRuns(task.id)).toHaveLength(1)
  })

  it('marks interrupted recurring runs as uncertain and does not immediately replay them', async () => {
    const createdAt = new Date('2026-11-05T07:00:00.000Z')
    const task = await store.create({
      name: 'Recurring review',
      prompt: 'Review my tasks and suggest one priority.',
      mode: 'assistant',
      schedule: { kind: 'daily', time: '08:30' }
    }, createdAt)
    const startedAt = '2026-11-05T08:30:00.000Z'
    const recoveryTime = new Date('2026-11-06T07:00:00.000Z')

    await store.recoverFromAudit([{
      id: 'audit-start-only', at: startedAt, sessionId: 'session', type: 'scheduled_task.started',
      data: { runId: 'interrupted-run', taskId: task.id, trigger: 'scheduled', startedAt }
    }], recoveryTime)

    expect(store.listRuns(task.id)[0]).toMatchObject({
      id: 'interrupted-run', status: 'failed', startedAt,
      error: expect.stringContaining('outcome is unknown')
    })
    expect(Date.parse(store.get(task.id).nextRunAt ?? '')).toBeGreaterThan(recoveryTime.getTime())
    expect(store.due(recoveryTime)).toHaveLength(0)
  })
})
