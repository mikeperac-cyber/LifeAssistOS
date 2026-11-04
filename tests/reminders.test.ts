import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { PlanningStore } from '../src/core/planning'
import { TaskReminderScheduler } from '../src/core/reminders'

describe('task reminder scheduler', () => {
  it('delivers due reminders once and skips tasks completed before they are due', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'mike-assist-reminder-scheduler-'))
    const planning = new PlanningStore(path.join(dir, 'planning.sqlite'))
    await planning.init()
    const dueAt = new Date(Date.now() + 60_000).toISOString()
    const reminder = planning.addTask({ title: 'Prepare tomorrow’s IELTS lesson', remindAt: dueAt })
    const completed = planning.addTask({ title: 'Pay electricity bill', remindAt: dueAt })
    planning.updateTask(completed.id, { status: 'done' })
    const delivered: string[] = []
    const scheduler = new TaskReminderScheduler(
      planning,
      (task) => { delivered.push(task.id) },
      15_000,
      () => new Date(Date.now() + 120_000)
    )

    await scheduler.checkDue()
    await scheduler.checkDue()
    expect(delivered).toEqual([reminder.id])
    expect(planning.listDueReminders(new Date(Date.now() + 120_000).toISOString())).toHaveLength(0)

    scheduler.stop()
    planning.close()
    await rm(dir, { recursive: true, force: true })
  })

  it('keeps a reminder pending if system notification delivery fails', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'mike-assist-reminder-retry-'))
    const planning = new PlanningStore(path.join(dir, 'planning.sqlite'))
    await planning.init()
    const dueAt = new Date(Date.now() + 60_000).toISOString()
    const reminder = planning.addTask({ title: 'Submit learner notes', remindAt: dueAt })
    const time = () => new Date(Date.now() + 120_000)
    const delivered: string[] = []
    let shouldFail = true
    const scheduler = new TaskReminderScheduler(planning, (task) => {
      if (shouldFail) throw new Error('notification unavailable')
      delivered.push(task.id)
    }, 15_000, time)

    await scheduler.checkDue()
    expect(planning.listDueReminders(time().toISOString())).toHaveLength(1)
    shouldFail = false
    await scheduler.checkDue()
    expect(delivered).toEqual([reminder.id])
    expect(planning.listDueReminders(time().toISOString())).toHaveLength(0)

    scheduler.stop()
    planning.close()
    await rm(dir, { recursive: true, force: true })
  })
})
