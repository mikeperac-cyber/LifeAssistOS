import { randomUUID } from 'node:crypto'
import { backup, DatabaseSync } from 'node:sqlite'
import { mkdir } from 'node:fs/promises'
import path from 'node:path'
import { openSQLiteDatabase } from './sqlite'
import type { InboxItem, PlanTask, PlanTaskPriority, PlanTaskStatus, TodaySnapshot } from '../shared/types'
import { assertDateOnly } from '../shared/date-only'

interface TaskRow {
  id: string
  title: string
  notes: string
  due_date: string | null
  remind_at: string | null
  reminder_notified_at: string | null
  priority: PlanTaskPriority
  status: PlanTaskStatus
  created_at: string
  updated_at: string
  completed_at: string | null
  parent_task_id: string | null
  source_inbox_id: string | null
}

interface InboxRow {
  id: string
  text: string
  created_at: string
  converted_task_id: string | null
  dismissed_at: string | null
}

export interface PendingTaskReminder { id: string; title: string; remindAt: string }

/** Local tasks and a quick capture inbox backed by the existing planning.sqlite file. */
export class PlanningStore {
  private db: DatabaseSync
  private closed = false

  constructor(private readonly file: string) { this.db = openSQLiteDatabase(file) }

  async init(): Promise<void> {
    if (this.closed) {
      this.db = openSQLiteDatabase(this.file)
      this.closed = false
    }
    await mkdir(path.dirname(this.dbPath), { recursive: true })
    this.db.exec('PRAGMA journal_mode = WAL; PRAGMA synchronous = FULL;')
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS tasks (
        id TEXT PRIMARY KEY, title TEXT NOT NULL, notes TEXT NOT NULL, due_date TEXT,
        remind_at TEXT, reminder_notified_at TEXT,
        priority TEXT NOT NULL CHECK (priority IN ('low', 'normal', 'high')),
        status TEXT NOT NULL CHECK (status IN ('open', 'done', 'cancelled')),
        created_at TEXT NOT NULL, updated_at TEXT NOT NULL, completed_at TEXT,
        parent_task_id TEXT, source_inbox_id TEXT
      );
      CREATE TABLE IF NOT EXISTS inbox (
        id TEXT PRIMARY KEY, text TEXT NOT NULL, created_at TEXT NOT NULL,
        converted_task_id TEXT, dismissed_at TEXT
      );
      CREATE INDEX IF NOT EXISTS tasks_due_status ON tasks(due_date, status);
      CREATE INDEX IF NOT EXISTS inbox_active ON inbox(dismissed_at, converted_task_id);
    `)
    const columns = this.db.prepare('PRAGMA table_info(tasks)').all() as Array<{ name: string }>
    const names = new Set(columns.map((column) => column.name))
    // Add new fields in place. Old source columns and task_exports are deliberately left untouched.
    if (!names.has('parent_task_id')) this.db.exec('ALTER TABLE tasks ADD COLUMN parent_task_id TEXT')
    if (!names.has('source_inbox_id')) this.db.exec('ALTER TABLE tasks ADD COLUMN source_inbox_id TEXT')
    if (!names.has('remind_at')) this.db.exec('ALTER TABLE tasks ADD COLUMN remind_at TEXT')
    if (!names.has('reminder_notified_at')) this.db.exec('ALTER TABLE tasks ADD COLUMN reminder_notified_at TEXT')
  }

  snapshot(date = localDate()): TodaySnapshot {
    assertDateOnly(date)
    const tasks = this.db.prepare(
      "SELECT * FROM tasks WHERE status = 'open' AND (due_date IS NULL OR due_date <= ?) ORDER BY CASE priority WHEN 'high' THEN 0 WHEN 'normal' THEN 1 ELSE 2 END, due_date IS NULL, due_date, created_at"
    ).all(date) as unknown as TaskRow[]
    const inbox = this.db.prepare(
      'SELECT * FROM inbox WHERE dismissed_at IS NULL AND converted_task_id IS NULL ORDER BY created_at DESC'
    ).all() as unknown as InboxRow[]
    return { date, tasks: tasks.map(taskFromRow), inbox: inbox.map(inboxFromRow) }
  }

  listTasks(includeCompleted = false): PlanTask[] {
    const rows = this.db.prepare(
      `SELECT * FROM tasks ${includeCompleted ? '' : "WHERE status = 'open'"} ORDER BY status, due_date IS NULL, due_date, created_at DESC`
    ).all() as unknown as TaskRow[]
    return rows.map(taskFromRow)
  }

  addTask(input: {
    title: string
    notes?: string
    dueDate?: string | null
    remindAt?: string | null
    priority?: PlanTaskPriority
    parentTaskId?: string | null
    sourceInboxId?: string
  }): PlanTask {
    const title = input.title.trim().slice(0, 240)
    if (!title) throw new Error('A task needs a title.')
    const priority = input.priority ?? 'normal'
    if (!isPriority(priority)) throw new Error('Choose a valid task priority.')
    const now = new Date().toISOString()
    const parentTaskId = input.parentTaskId ?? null
    const id = randomUUID()
    this.assertValidParentTask(id, parentTaskId)
    const task: PlanTask = {
      id, title, notes: (input.notes ?? '').trim().slice(0, 2_000),
      dueDate: normalizeDate(input.dueDate), remindAt: normalizeReminderAt(input.remindAt),
      priority, status: 'open', createdAt: now, updatedAt: now, completedAt: null,
      parentTaskId, sourceInboxId: input.sourceInboxId
    }
    this.db.prepare(
      'INSERT INTO tasks (id, title, notes, due_date, remind_at, reminder_notified_at, priority, status, created_at, updated_at, completed_at, parent_task_id, source_inbox_id) VALUES (?, ?, ?, ?, ?, NULL, ?, ?, ?, ?, NULL, ?, ?)'
    ).run(task.id, task.title, task.notes, task.dueDate, task.remindAt, task.priority, task.status, task.createdAt, task.updatedAt, task.parentTaskId, task.sourceInboxId ?? null)
    return task
  }

  updateTask(id: string, patch: {
    title?: string
    notes?: string
    dueDate?: string | null
    remindAt?: string | null
    priority?: PlanTaskPriority
    status?: PlanTaskStatus
    parentTaskId?: string | null
  }): PlanTask {
    const current = this.getTask(id)
    const status = patch.status ?? current.status
    if (!isStatus(status)) throw new Error('Choose a valid task status.')
    const priority = patch.priority ?? current.priority
    if (!isPriority(priority)) throw new Error('Choose a valid task priority.')
    const parentTaskId = patch.parentTaskId === undefined ? current.parentTaskId : patch.parentTaskId
    this.assertValidParentTask(id, parentTaskId)
    const task: PlanTask = {
      ...current,
      title: patch.title === undefined ? current.title : patch.title.trim().slice(0, 240),
      notes: patch.notes === undefined ? current.notes : patch.notes.trim().slice(0, 2_000),
      dueDate: patch.dueDate === undefined ? current.dueDate : normalizeDate(patch.dueDate),
      remindAt: patch.remindAt === undefined ? current.remindAt : normalizeReminderAt(patch.remindAt),
      priority, status, parentTaskId, updatedAt: new Date().toISOString(),
      completedAt: status === 'done' ? (current.completedAt ?? new Date().toISOString()) : null
    }
    if (!task.title) throw new Error('A task needs a title.')
    const resetReminder = task.remindAt !== current.remindAt || (status === 'open' && current.status !== 'open')
    const prior = this.db.prepare('SELECT reminder_notified_at FROM tasks WHERE id = ?').get(id) as { reminder_notified_at: string | null }
    const reminderNotifiedAt = resetReminder ? null : prior.reminder_notified_at
    this.db.prepare(
      'UPDATE tasks SET title = ?, notes = ?, due_date = ?, remind_at = ?, reminder_notified_at = ?, priority = ?, status = ?, parent_task_id = ?, updated_at = ?, completed_at = ? WHERE id = ?'
    ).run(task.title, task.notes, task.dueDate, task.remindAt, reminderNotifiedAt, task.priority, task.status, task.parentTaskId, task.updatedAt, task.completedAt, id)
    return task
  }

  listDueReminders(through = new Date().toISOString()): PendingTaskReminder[] {
    const rows = this.db.prepare(
      "SELECT id, title, remind_at FROM tasks WHERE status = 'open' AND remind_at IS NOT NULL AND remind_at <= ? AND reminder_notified_at IS NULL ORDER BY remind_at LIMIT 50"
    ).all(through) as Array<{ id: string; title: string; remind_at: string }>
    return rows.map((row) => ({ id: row.id, title: row.title, remindAt: row.remind_at }))
  }

  markReminderNotified(id: string, remindAt: string, notifiedAt = new Date().toISOString()): boolean {
    const result = this.db.prepare(
      "UPDATE tasks SET reminder_notified_at = ? WHERE id = ? AND status = 'open' AND remind_at = ? AND reminder_notified_at IS NULL"
    ).run(notifiedAt, id, remindAt)
    return result.changes > 0
  }

  getTask(id: string): PlanTask {
    const row = this.db.prepare('SELECT * FROM tasks WHERE id = ?').get(id) as TaskRow | undefined
    if (!row) throw new Error('That task no longer exists.')
    return taskFromRow(row)
  }

  capture(text: string): InboxItem {
    const clean = text.trim().slice(0, 2_000)
    if (!clean) throw new Error('Capture something before saving it to the inbox.')
    const item: InboxItem = { id: randomUUID(), text: clean, createdAt: new Date().toISOString(), convertedTaskId: null, dismissedAt: null }
    this.db.prepare('INSERT INTO inbox (id, text, created_at, converted_task_id, dismissed_at) VALUES (?, ?, ?, NULL, NULL)').run(item.id, item.text, item.createdAt)
    return item
  }

  convertInbox(id: string, input?: {
    title?: string
    notes?: string
    dueDate?: string | null
    remindAt?: string | null
    priority?: PlanTaskPriority
  }): PlanTask {
    this.db.exec('BEGIN IMMEDIATE')
    try {
      const row = this.db.prepare('SELECT * FROM inbox WHERE id = ?').get(id) as InboxRow | undefined
      if (!row || row.dismissed_at || row.converted_task_id) throw new Error('That inbox item is no longer active.')
      const task = this.addTask({ ...input, title: input?.title ?? row.text, sourceInboxId: id })
      const result = this.db.prepare(
        'UPDATE inbox SET converted_task_id = ? WHERE id = ? AND dismissed_at IS NULL AND converted_task_id IS NULL'
      ).run(task.id, id)
      if (result.changes === 0) throw new Error('That inbox item is no longer active.')
      this.db.exec('COMMIT')
      return task
    } catch (error) {
      try { this.db.exec('ROLLBACK') } catch { /* Preserve the original failure. */ }
      throw error
    }
  }

  dismissInbox(id: string): void {
    const result = this.db.prepare(
      'UPDATE inbox SET dismissed_at = ? WHERE id = ? AND dismissed_at IS NULL AND converted_task_id IS NULL'
    ).run(new Date().toISOString(), id)
    if (result.changes === 0) throw new Error('That inbox item is no longer active.')
  }

  async backupTo(file: string): Promise<void> {
    await mkdir(path.dirname(file), { recursive: true })
    await backup(this.db, file)
  }

  close(): void { if (!this.closed) { this.db.close(); this.closed = true } }

  private get dbPath(): string {
    const row = this.db.prepare('PRAGMA database_list').get() as { file?: string } | undefined
    return row?.file ? path.dirname(row.file) : process.cwd()
  }

  private assertValidParentTask(taskId: string, parentTaskId: string | null): void {
    if (parentTaskId === null) return
    if (parentTaskId === taskId) throw new Error('A task cannot be its own parent.')
    const parent = this.db.prepare('SELECT id, parent_task_id FROM tasks WHERE id = ?').get(parentTaskId) as { id: string; parent_task_id: string | null } | undefined
    if (!parent) throw new Error('Choose an existing parent task.')
    if (parent.parent_task_id !== null) throw new Error('Subtasks cannot have their own subtasks.')
  }
}

function taskFromRow(row: TaskRow): PlanTask {
  return {
    id: row.id, title: row.title, notes: row.notes, dueDate: row.due_date,
    remindAt: row.remind_at, priority: row.priority, status: row.status,
    createdAt: row.created_at, updatedAt: row.updated_at, completedAt: row.completed_at,
    parentTaskId: row.parent_task_id, sourceInboxId: row.source_inbox_id ?? undefined
  }
}

function inboxFromRow(row: InboxRow): InboxItem {
  return { id: row.id, text: row.text, createdAt: row.created_at, convertedTaskId: row.converted_task_id, dismissedAt: row.dismissed_at }
}

function isPriority(value: string): value is PlanTaskPriority { return value === 'low' || value === 'normal' || value === 'high' }
function isStatus(value: string): value is PlanTaskStatus { return value === 'open' || value === 'done' || value === 'cancelled' }
function normalizeDate(value: string | null | undefined): string | null { return value ? assertDateOnly(value) : null }
function normalizeReminderAt(value: string | null | undefined): string | null {
  if (!value) return null
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:\d{2})$/i.test(value)) {
    throw new Error('Use an ISO-8601 date and time with a UTC offset for the reminder.')
  }
  const timestamp = Date.parse(value)
  if (!Number.isFinite(timestamp)) throw new Error('Use a valid date and time for the reminder.')
  if (timestamp <= Date.now()) throw new Error('Choose a reminder time in the future.')
  return new Date(timestamp).toISOString()
}
function localDate(): string {
  const date = new Date()
  return new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 10)
}
