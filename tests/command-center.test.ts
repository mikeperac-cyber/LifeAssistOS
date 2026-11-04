import { mkdtemp, rm } from 'node:fs/promises'
import { DatabaseSync } from 'node:sqlite'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { ResearchStore } from '../src/core/research'
import { VaultStore } from '../src/core/vault'
import { PlanningStore } from '../src/core/planning'

describe('research desk store', () => {
  it('keeps projects and captured sources local', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'mike-assist-research-'))
    const store = new ResearchStore(path.join(dir, 'research.sqlite'))
    await store.init()
    const project = store.create({ title: 'IELTS feedback', question: 'What makes useful band 6.5 feedback?' })
    const source = store.addSource({ projectId: project.id, url: 'https://example.com/feedback', title: 'Feedback guide', content: 'Use one actionable target and one example.' })
    expect(store.get(project.id).sources[0]?.content).toContain('actionable')
    expect(source.contentChars).toBeGreaterThan(10)
    store.archive(project.id)
    expect(store.list()).toHaveLength(0)
    expect(store.list(true)[0]?.status).toBe('archived')
    store.close()
    await rm(dir, { recursive: true, force: true })
  })
})

describe('FTS5 knowledge vault', () => {
  it('indexes, searches, updates, and deletes documents', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'mike-assist-vault-'))
    const store = new VaultStore(path.join(dir, 'vault.sqlite'))
    await store.init()
    const document = store.create({ title: 'Thesis frames', body: 'A clear thesis answers the question and previews the position.', tags: ['IELTS', 'writing'] })
    expect(store.search('thesis')[0]?.document.id).toBe(document.id)
    store.update(document.id, { body: 'A useful thesis makes the writer position precise.' })
    expect(store.search('precise')[0]?.document.title).toBe('Thesis frames')
    store.delete(document.id)
    expect(store.search('precise')).toHaveLength(0)
    store.close()
    await rm(dir, { recursive: true, force: true })
  })
})

describe('Today planning store', () => {
  it('captures inbox items and converts them into tasks', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'mike-assist-planning-'))
    const store = new PlanningStore(path.join(dir, 'planning.sqlite'))
    await store.init()
    const inbox = store.capture('Email the IELTS group about Monday')
    const task = store.convertInbox(inbox.id, { priority: 'high' })
    expect(task.sourceInboxId).toBe(inbox.id)
    expect(store.snapshot().inbox).toHaveLength(0)
    expect(store.updateTask(task.id, { status: 'done' }).completedAt).toBeTruthy()
    expect(store.snapshot().tasks).toHaveLength(0)
    const linked = store.addTask({ title: 'Draft the lesson opener', sourceGoalId: 'goal-123' })
    expect(linked.sourceGoalId).toBe('goal-123')
    expect(() => store.addTask({ title: 'Invalid due date', dueDate: '2026-02-31' })).toThrow(/real calendar date/)
    expect(() => store.snapshot('2026-02-31')).toThrow(/real calendar date/)
    store.close()
    await rm(dir, { recursive: true, force: true })
  })

  it('persists, reschedules, and clears one-time task reminders', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'mike-assist-task-reminders-'))
    const store = new PlanningStore(path.join(dir, 'planning.sqlite'))
    await store.init()
    const firstReminder = new Date(Date.now() + 60_000).toISOString()
    const task = store.addTask({ title: 'Call the IELTS group', remindAt: firstReminder })

    expect(store.getTask(task.id).remindAt).toBe(firstReminder)
    expect(store.listDueReminders(firstReminder)).toEqual([{ id: task.id, title: task.title, remindAt: firstReminder }])
    expect(store.markReminderNotified(task.id, firstReminder, new Date().toISOString())).toBe(true)
    expect(store.markReminderNotified(task.id, firstReminder, new Date().toISOString())).toBe(false)
    expect(store.listDueReminders(firstReminder)).toHaveLength(0)

    const secondReminder = new Date(Date.now() + 120_000).toISOString()
    store.updateTask(task.id, { remindAt: secondReminder })
    expect(store.listDueReminders(secondReminder)).toHaveLength(1)
    store.updateTask(task.id, { remindAt: null })
    expect(store.getTask(task.id).remindAt).toBeNull()
    expect(store.listDueReminders(new Date(Date.now() + 300_000).toISOString())).toHaveLength(0)

    expect(() => store.addTask({ title: 'Invalid reminder', remindAt: '2026-11-03' })).toThrow(/date and time/)
    expect(() => store.addTask({ title: 'Past reminder', remindAt: new Date(Date.now() - 60_000).toISOString() })).toThrow(/future/)
    store.close()
    await rm(dir, { recursive: true, force: true })
  })

  it('migrates existing plan databases without losing old tasks', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'mike-assist-plan-migration-'))
    const file = path.join(dir, 'planning.sqlite')
    const legacy = new DatabaseSync(file)
    legacy.exec(`
      CREATE TABLE tasks (
        id TEXT PRIMARY KEY, title TEXT NOT NULL, notes TEXT NOT NULL, due_date TEXT,
        priority TEXT NOT NULL CHECK (priority IN ('low', 'normal', 'high')),
        status TEXT NOT NULL CHECK (status IN ('open', 'done', 'cancelled')),
        created_at TEXT NOT NULL, updated_at TEXT NOT NULL, completed_at TEXT,
        source_inbox_id TEXT, source_goal_id TEXT
      );
      CREATE TABLE inbox (
        id TEXT PRIMARY KEY, text TEXT NOT NULL, created_at TEXT NOT NULL,
        converted_task_id TEXT, dismissed_at TEXT
      );
      INSERT INTO tasks VALUES ('legacy-task', 'Keep this task', '', NULL, 'normal', 'open', '2026-11-01T00:00:00.000Z', '2026-11-01T00:00:00.000Z', NULL, NULL, NULL);
    `)
    legacy.close()

    const store = new PlanningStore(file)
    await store.init()
    expect(store.getTask('legacy-task')).toMatchObject({ title: 'Keep this task', remindAt: null })
    store.close()
    await rm(dir, { recursive: true, force: true })
  })
})
