import { mkdtemp, rm } from 'node:fs/promises'
import { DatabaseSync } from 'node:sqlite'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { PlanningStore } from '../src/core/planning'

const directories: string[] = []
const stores: PlanningStore[] = []

afterEach(async () => {
  for (const store of stores.splice(0)) store.close()
  for (const directory of directories.splice(0)) await rm(directory, { recursive: true, force: true })
})

async function createStore(): Promise<PlanningStore> {
  const directory = await mkdtemp(path.join(tmpdir(), 'mike-assist-todo-'))
  directories.push(directory)
  const store = new PlanningStore(path.join(directory, 'planning.sqlite'))
  stores.push(store)
  await store.init()
  return store
}

function createLegacyPlanningDatabase(file: string): void {
  const database = new DatabaseSync(file)
  database.exec(`
    CREATE TABLE tasks (
      id TEXT PRIMARY KEY, title TEXT NOT NULL, notes TEXT NOT NULL, due_date TEXT,
      remind_at TEXT, reminder_notified_at TEXT,
      priority TEXT NOT NULL CHECK (priority IN ('low', 'normal', 'high')),
      status TEXT NOT NULL CHECK (status IN ('open', 'done', 'cancelled')),
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL, completed_at TEXT,
      source_inbox_id TEXT, source_goal_id TEXT,
      source_email_provider TEXT, source_email_message_id TEXT,
      source_calendar_provider TEXT, source_calendar_event_id TEXT,
      source_task_provider TEXT, source_task_list_id TEXT, source_task_id TEXT
    );
    CREATE TABLE inbox (
      id TEXT PRIMARY KEY, text TEXT NOT NULL, created_at TEXT NOT NULL,
      converted_task_id TEXT, dismissed_at TEXT
    );
    CREATE TABLE task_exports (id TEXT PRIMARY KEY, task_id TEXT, remote_task_id TEXT);
    INSERT INTO tasks (
      id, title, notes, due_date, remind_at, reminder_notified_at,
      priority, status, created_at, updated_at, completed_at,
      source_inbox_id, source_goal_id, source_email_provider, source_email_message_id,
      source_calendar_provider, source_calendar_event_id, source_task_provider,
      source_task_list_id, source_task_id
    ) VALUES (
      'legacy-task', 'Keep this task', 'Legacy notes', NULL, NULL, NULL,
      'normal', 'open', '2026-11-01T00:00:00.000Z', '2026-11-01T00:00:00.000Z', NULL,
      NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL
    );
    INSERT INTO inbox (id, text, created_at, converted_task_id, dismissed_at)
      VALUES ('legacy-inbox', 'Keep this inbox item', '2026-11-01T00:00:00.000Z', NULL, NULL);
    INSERT INTO task_exports (id, task_id, remote_task_id) VALUES ('legacy-export', 'legacy-task', 'remote-id');
  `)
  database.close()
}

describe('todo planning store', () => {
  it('test_additive_parent_task_migration_preserves_tasks_and_inbox', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'mike-assist-todo-legacy-'))
    directories.push(directory)
    const file = path.join(directory, 'planning.sqlite')
    createLegacyPlanningDatabase(file)

    const store = new PlanningStore(file)
    stores.push(store)
    await store.init()

    expect(store.getTask('legacy-task')).toMatchObject({
      id: 'legacy-task',
      title: 'Keep this task',
      notes: 'Legacy notes',
      parentTaskId: null,
      recurrenceRule: null,
      recurrenceDate: null,
      recurrenceSeriesId: null
    })
    expect(store.snapshot().inbox).toContainEqual(expect.objectContaining({
      id: 'legacy-inbox',
      text: 'Keep this inbox item'
    }))
    const upgraded = new DatabaseSync(file, { readOnly: true })
    try {
      const columns = (upgraded.prepare('PRAGMA table_info(tasks)').all() as Array<{ name: string }>).map((item) => item.name)
      expect(columns).toEqual(expect.arrayContaining(['source_goal_id', 'source_email_message_id', 'source_calendar_event_id', 'source_task_id']))
      expect(upgraded.prepare("SELECT remote_task_id FROM task_exports WHERE id = 'legacy-export'").get()).toEqual({ remote_task_id: 'remote-id' })
    } finally { upgraded.close() }
  })

  it('test_reopen_preserves_existing_tasks_and_inbox', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'mike-assist-todo-reopen-'))
    directories.push(directory)
    const file = path.join(directory, 'planning.sqlite')
    const first = new PlanningStore(file)
    stores.push(first)
    await first.init()
    const open = first.addTask({ title: 'Open task' })
    const done = first.addTask({ title: 'Completed task' })
    first.updateTask(done.id, { status: 'done' })
    first.capture('Unsorted Inbox item')
    first.close()

    const reopened = new PlanningStore(file)
    stores.push(reopened)
    await reopened.init()

    expect(reopened.listTasks(true)).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: open.id, title: 'Open task', status: 'open' }),
      expect.objectContaining({ id: done.id, title: 'Completed task', status: 'done' })
    ]))
    expect(reopened.snapshot().inbox).toEqual(expect.arrayContaining([
      expect.objectContaining({ text: 'Unsorted Inbox item', convertedTaskId: null, dismissedAt: null })
    ]))
  })

  it('test_parent_task_validation_rejects_cycles_and_nested_children', async () => {
    const store = await createStore()
    const parent = store.addTask({ title: 'Parent task' })
    const child = store.addTask({ title: 'Child task', parentTaskId: parent.id })

    expect(child.parentTaskId).toBe(parent.id)
    expect(() => store.updateTask(parent.id, { parentTaskId: parent.id })).toThrow(/parent/i)
    expect(() => store.updateTask(parent.id, { parentTaskId: child.id })).toThrow(/subtasks/i)
    expect(() => store.addTask({ title: 'Missing parent', parentTaskId: 'missing-parent' })).toThrow(/parent/i)
    expect(store.updateTask(child.id, { parentTaskId: null }).parentTaskId).toBeNull()
  })

  it('test_completing_parent_does_not_complete_subtasks', async () => {
    const store = await createStore()
    const parent = store.addTask({ title: 'Parent task' })
    const child = store.addTask({ title: 'Child task', parentTaskId: parent.id })

    store.updateTask(parent.id, { status: 'done' })

    expect(store.getTask(parent.id).status).toBe('done')
    expect(store.getTask(child.id)).toMatchObject({ parentTaskId: parent.id, status: 'open' })
  })

  it('converts an Inbox item with the edited task details', async () => {
    const store = await createStore()
    const inbox = store.capture('Original capture')
    const remindAt = new Date(Date.now() + 60_000).toISOString()

    const task = store.convertInbox(inbox.id, {
      title: 'Edited title',
      notes: 'Useful task notes',
      dueDate: '2026-11-10',
      remindAt,
      priority: 'high'
    })

    expect(store.getTask(task.id)).toMatchObject({
      title: 'Edited title',
      notes: 'Useful task notes',
      dueDate: '2026-11-10',
      remindAt,
      priority: 'high',
      sourceInboxId: inbox.id
    })
  })

  it('requires a due date before a task can repeat', async () => {
    const store = await createStore()
    expect(() => store.addTask({ title: 'Daily practice', recurrenceRule: { frequency: 'daily' } })).toThrow(/due date/i)
    expect(store.listTasks(true)).toEqual([])
  })

  it('preserves the recurrence invariant when an existing occurrence is edited', async () => {
    const store = await createStore()
    const today = new Date(Date.now() - new Date().getTimezoneOffset() * 60_000).toISOString().slice(0, 10)
    const parent = store.addTask({ title: 'Parent', dueDate: today })
    const task = store.addTask({ title: 'Daily practice', dueDate: today, recurrenceRule: { frequency: 'daily' } })

    expect(() => store.updateTask(task.id, { dueDate: null })).toThrow(/due date/i)
    expect(() => store.updateTask(task.id, { parentTaskId: parent.id })).toThrow(/subtasks cannot repeat/i)
    expect(store.getTask(task.id)).toMatchObject({ dueDate: today, parentTaskId: null, recurrenceRule: { frequency: 'daily' } })
  })

  it('creates the next occurrence on completion and retains the completed occurrence', async () => {
    const store = await createStore()
    const today = new Date(Date.now() - new Date().getTimezoneOffset() * 60_000).toISOString().slice(0, 10)
    const task = store.addTask({
      title: 'Read a lesson', notes: 'Ten pages', dueDate: today, priority: 'high',
      recurrenceRule: { frequency: 'daily' }
    })

    store.updateTask(task.id, { status: 'done' })
    const tasks = store.listTasks(true)
    const next = tasks.find((item) => item.status === 'open')!

    expect(store.getTask(task.id)).toMatchObject({ status: 'done', recurrenceDate: today, recurrenceSeriesId: task.recurrenceSeriesId })
    expect(next).toMatchObject({
      title: 'Read a lesson', notes: 'Ten pages', priority: 'high', status: 'open',
      dueDate: addLocalDays(today, 1), recurrenceDate: addLocalDays(today, 1),
      recurrenceSeriesId: task.recurrenceSeriesId, recurrenceRule: { frequency: 'daily' },
      remindAt: null, plannedDate: null
    })
    expect(tasks.filter((item) => item.recurrenceSeriesId === task.recurrenceSeriesId)).toHaveLength(2)

    store.updateTask(task.id, { status: 'done' })
    expect(store.listTasks(true).filter((item) => item.recurrenceSeriesId === task.recurrenceSeriesId)).toHaveLength(2)
  })

  it('keeps the recurrence pattern when one occurrence is rescheduled', async () => {
    const store = await createStore()
    const today = new Date(Date.now() - new Date().getTimezoneOffset() * 60_000).toISOString().slice(0, 10)
    const original = store.addTask({ title: 'Practice', dueDate: today, recurrenceRule: { frequency: 'daily' } })
    const movedDate = addLocalDays(today, 3)
    store.updateTask(original.id, { dueDate: movedDate })

    expect(store.getTask(original.id)).toMatchObject({ dueDate: movedDate, recurrenceDate: today })
    store.updateTask(original.id, { status: 'done' })
    const next = store.listTasks().find((item) => item.recurrenceSeriesId === original.recurrenceSeriesId && item.status === 'open')!
    expect(next.dueDate).toBe(addLocalDays(movedDate, 1))
    expect(next.recurrenceRule).toEqual(original.recurrenceRule)
  })

  it('skips one occurrence into history and advances once', async () => {
    const store = await createStore()
    const today = new Date(Date.now() - new Date().getTimezoneOffset() * 60_000).toISOString().slice(0, 10)
    const task = store.addTask({ title: 'Daily review', dueDate: today, recurrenceRule: { frequency: 'daily' } })

    store.skipTaskOccurrence(task.id)
    expect(store.getTask(task.id).status).toBe('cancelled')
    expect(store.listTasks().filter((item) => item.recurrenceSeriesId === task.recurrenceSeriesId)).toHaveLength(1)
    expect(store.listTasks().find((item) => item.recurrenceSeriesId === task.recurrenceSeriesId)?.dueDate).toBe(addLocalDays(today, 1))
    expect(() => store.skipTaskOccurrence(task.id)).toThrow(/open recurring/i)
    expect(store.listTasks(true).filter((item) => item.recurrenceSeriesId === task.recurrenceSeriesId)).toHaveLength(2)
  })

  it('honors an inclusive recurrence end date without creating a later occurrence', async () => {
    const store = await createStore()
    const today = new Date(Date.now() - new Date().getTimezoneOffset() * 60_000).toISOString().slice(0, 10)
    const tomorrow = addLocalDays(today, 1)
    const task = store.addTask({ title: 'Two day routine', dueDate: today, recurrenceRule: { frequency: 'daily', endsOn: tomorrow } })
    store.updateTask(task.id, { status: 'done' })
    const next = store.listTasks().find((item) => item.recurrenceSeriesId === task.recurrenceSeriesId)!
    store.updateTask(next.id, { status: 'done' })
    expect(store.listTasks(true).filter((item) => item.recurrenceSeriesId === task.recurrenceSeriesId)).toHaveLength(2)
  })

  it('rolls a completion back when the next recurring row cannot be inserted', async () => {
    const store = await createStore()
    const today = new Date(Date.now() - new Date().getTimezoneOffset() * 60_000).toISOString().slice(0, 10)
    const task = store.addTask({ title: 'Protected routine', dueDate: today, recurrenceRule: { frequency: 'daily' } })
    const db = (store as unknown as { db: DatabaseSync }).db
    db.exec("CREATE TRIGGER reject_recurring_insert BEFORE INSERT ON tasks WHEN NEW.title = 'Protected routine' BEGIN SELECT RAISE(ABORT, 'forced recurring insert failure'); END")

    expect(() => store.updateTask(task.id, { status: 'done' })).toThrow(/incompatible|forced/i)
    expect(store.getTask(task.id).status).toBe('open')
    expect(store.listTasks().filter((item) => item.recurrenceSeriesId === task.recurrenceSeriesId)).toHaveLength(1)
  })
})

function addLocalDays(value: string, amount: number): string {
  const [year, month, day] = value.split('-').map(Number)
  return new Date(Date.UTC(year, month - 1, day + amount)).toISOString().slice(0, 10)
}
