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
      parentTaskId: null
    })
    expect(store.snapshot().inbox).toContainEqual(expect.objectContaining({
      id: 'legacy-inbox',
      text: 'Keep this inbox item'
    }))
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
})
