import { mkdtemp, rm } from 'node:fs/promises'
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
})
