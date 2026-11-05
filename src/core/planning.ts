import { randomUUID } from 'node:crypto'
import { backup, DatabaseSync } from 'node:sqlite'
import { openSQLiteDatabase } from './sqlite'
import { mkdir } from 'node:fs/promises'
import path from 'node:path'
import type { CalendarTaskProvider, CalendarTaskSource, EmailTaskProvider, EmailTaskSource, InboxItem, PlanTask, PlanTaskPriority, PlanTaskStatus, TaskExportProvider, TaskExportRecord, TaskExportStatus, TaskExportSyncStatus, TodaySnapshot } from '../shared/types'
import { assertDateOnly } from '../shared/date-only'

interface TaskRow { id: string; title: string; notes: string; due_date: string | null; remind_at: string | null; reminder_notified_at: string | null; priority: PlanTaskPriority; status: PlanTaskStatus; created_at: string; updated_at: string; completed_at: string | null; source_inbox_id: string | null; source_goal_id: string | null; source_email_provider: string | null; source_email_message_id: string | null; source_calendar_provider: string | null; source_calendar_event_id: string | null }
interface InboxRow { id: string; text: string; created_at: string; converted_task_id: string | null; dismissed_at: string | null }
interface TaskExportRow { task_id: string; provider: TaskExportProvider; task_list_id: string; status: TaskExportStatus; remote_task_id: string | null; updated_at: string; sync_status: TaskExportSyncStatus; synced_local_updated_at: string | null; synced_title: string | null; synced_notes: string | null; synced_due_date: string | null; synced_priority: PlanTaskPriority | null; remote_etag: string | null }

export interface TaskExportSyncSnapshot { localUpdatedAt: string; title: string; notes: string; dueDate: string | null; priority?: PlanTaskPriority; remoteEtag?: string }

export interface PendingTaskReminder { id: string; title: string; remindAt: string }

/** Local tasks and capture inbox for the Today command center. */
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
        created_at TEXT NOT NULL, updated_at TEXT NOT NULL, completed_at TEXT, source_inbox_id TEXT, source_goal_id TEXT,
        source_email_provider TEXT CHECK (source_email_provider IS NULL OR source_email_provider IN ('gmail', 'outlook')),
        source_email_message_id TEXT,
        source_calendar_provider TEXT CHECK (source_calendar_provider IS NULL OR source_calendar_provider IN ('google_calendar', 'microsoft_calendar')),
        source_calendar_event_id TEXT
      );
      CREATE TABLE IF NOT EXISTS inbox (
        id TEXT PRIMARY KEY, text TEXT NOT NULL, created_at TEXT NOT NULL,
        converted_task_id TEXT, dismissed_at TEXT
      );
      CREATE TABLE IF NOT EXISTS task_exports (
        task_id TEXT NOT NULL, provider TEXT NOT NULL CHECK (provider IN ('google_tasks', 'microsoft_todo')),
        task_list_id TEXT NOT NULL, status TEXT NOT NULL CHECK (status IN ('sending', 'sent', 'failed', 'uncertain')),
        remote_task_id TEXT, updated_at TEXT NOT NULL,
        sync_status TEXT NOT NULL DEFAULT 'idle' CHECK (sync_status IN ('idle', 'sending', 'failed', 'uncertain')),
        synced_local_updated_at TEXT, synced_title TEXT, synced_notes TEXT, synced_due_date TEXT,
        synced_priority TEXT CHECK (synced_priority IS NULL OR synced_priority IN ('low', 'normal', 'high')),
        remote_etag TEXT,
        PRIMARY KEY (task_id, provider, task_list_id)
      );
      CREATE INDEX IF NOT EXISTS tasks_due_status ON tasks(due_date, status);
      CREATE INDEX IF NOT EXISTS inbox_active ON inbox(dismissed_at, converted_task_id);
    `)
    const columns = this.db.prepare('PRAGMA table_info(tasks)').all() as Array<{ name: string }>
    if (!columns.some((column) => column.name === 'source_goal_id')) this.db.exec('ALTER TABLE tasks ADD COLUMN source_goal_id TEXT')
    if (!columns.some((column) => column.name === 'source_email_provider')) this.db.exec('ALTER TABLE tasks ADD COLUMN source_email_provider TEXT')
    if (!columns.some((column) => column.name === 'source_email_message_id')) this.db.exec('ALTER TABLE tasks ADD COLUMN source_email_message_id TEXT')
    this.db.exec('CREATE INDEX IF NOT EXISTS tasks_email_source ON tasks(source_email_provider, source_email_message_id) WHERE source_email_message_id IS NOT NULL')
    if (!columns.some((column) => column.name === 'source_calendar_provider')) this.db.exec("ALTER TABLE tasks ADD COLUMN source_calendar_provider TEXT CHECK (source_calendar_provider IS NULL OR source_calendar_provider IN ('google_calendar', 'microsoft_calendar'))")
    if (!columns.some((column) => column.name === 'source_calendar_event_id')) this.db.exec('ALTER TABLE tasks ADD COLUMN source_calendar_event_id TEXT')
    this.db.exec('CREATE UNIQUE INDEX IF NOT EXISTS tasks_calendar_source ON tasks(source_calendar_provider, source_calendar_event_id) WHERE source_calendar_event_id IS NOT NULL')
    if (!columns.some((column) => column.name === 'remind_at')) this.db.exec('ALTER TABLE tasks ADD COLUMN remind_at TEXT')
    if (!columns.some((column) => column.name === 'reminder_notified_at')) this.db.exec('ALTER TABLE tasks ADD COLUMN reminder_notified_at TEXT')
    const exportColumns = this.db.prepare('PRAGMA table_info(task_exports)').all() as Array<{ name: string }>
    if (!exportColumns.some((column) => column.name === 'sync_status')) this.db.exec("ALTER TABLE task_exports ADD COLUMN sync_status TEXT NOT NULL DEFAULT 'idle' CHECK (sync_status IN ('idle', 'sending', 'failed', 'uncertain'))")
    if (!exportColumns.some((column) => column.name === 'synced_local_updated_at')) this.db.exec('ALTER TABLE task_exports ADD COLUMN synced_local_updated_at TEXT')
    if (!exportColumns.some((column) => column.name === 'synced_title')) this.db.exec('ALTER TABLE task_exports ADD COLUMN synced_title TEXT')
    if (!exportColumns.some((column) => column.name === 'synced_notes')) this.db.exec('ALTER TABLE task_exports ADD COLUMN synced_notes TEXT')
    if (!exportColumns.some((column) => column.name === 'synced_due_date')) this.db.exec('ALTER TABLE task_exports ADD COLUMN synced_due_date TEXT')
    if (!exportColumns.some((column) => column.name === 'synced_priority')) this.db.exec("ALTER TABLE task_exports ADD COLUMN synced_priority TEXT CHECK (synced_priority IS NULL OR synced_priority IN ('low', 'normal', 'high'))")
    if (!exportColumns.some((column) => column.name === 'remote_etag')) this.db.exec('ALTER TABLE task_exports ADD COLUMN remote_etag TEXT')
    this.db.prepare("UPDATE task_exports SET status = 'uncertain', updated_at = ? WHERE status = 'sending'").run(new Date().toISOString())
    this.db.prepare("UPDATE task_exports SET sync_status = 'uncertain', updated_at = ? WHERE sync_status = 'sending'").run(new Date().toISOString())
  }

  snapshot(date = localDate()): TodaySnapshot {
    assertDateOnly(date)
    const tasks = this.db.prepare("SELECT * FROM tasks WHERE status = 'open' AND (due_date IS NULL OR due_date <= ?) ORDER BY CASE priority WHEN 'high' THEN 0 WHEN 'normal' THEN 1 ELSE 2 END, due_date IS NULL, due_date, created_at").all(date) as unknown as TaskRow[]
    const inbox = this.db.prepare('SELECT * FROM inbox WHERE dismissed_at IS NULL AND converted_task_id IS NULL ORDER BY created_at DESC').all() as unknown as InboxRow[]
    return { date, tasks: this.attachTaskExports(tasks.map(taskFromRow)), inbox: inbox.map(inboxFromRow) }
  }

  listTasks(includeCompleted = false): PlanTask[] {
    const rows = this.db.prepare(`SELECT * FROM tasks ${includeCompleted ? '' : "WHERE status = 'open'"} ORDER BY status, due_date IS NULL, due_date, created_at DESC`).all() as unknown as TaskRow[]
    return this.attachTaskExports(rows.map(taskFromRow))
  }

  addTask(input: { title: string; notes?: string; dueDate?: string | null; remindAt?: string | null; priority?: PlanTaskPriority; sourceInboxId?: string; sourceGoalId?: string; emailSource?: EmailTaskSource; calendarSource?: CalendarTaskSource }): PlanTask {
    const title = input.title.trim().slice(0, 240)
    if (!title) throw new Error('A task needs a title.')
    const priority = input.priority ?? 'normal'
    if (!['low', 'normal', 'high'].includes(priority)) throw new Error('Choose a valid task priority.')
    const now = new Date().toISOString()
    const emailSource = input.emailSource ? normalizeEmailTaskSource(input.emailSource) : undefined
    const calendarSource = input.calendarSource ? normalizeCalendarTaskSource(input.calendarSource) : undefined
    const task: PlanTask = { id: randomUUID(), title, notes: (input.notes ?? '').trim().slice(0, 2000), dueDate: normalizeDate(input.dueDate), remindAt: normalizeReminderAt(input.remindAt), priority, status: 'open', createdAt: now, updatedAt: now, completedAt: null, sourceInboxId: input.sourceInboxId, sourceGoalId: input.sourceGoalId, emailSource, calendarSource }
    this.db.prepare('INSERT INTO tasks (id, title, notes, due_date, remind_at, reminder_notified_at, priority, status, created_at, updated_at, completed_at, source_inbox_id, source_goal_id, source_email_provider, source_email_message_id, source_calendar_provider, source_calendar_event_id) VALUES (?, ?, ?, ?, ?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').run(task.id, task.title, task.notes, task.dueDate, task.remindAt, task.priority, task.status, task.createdAt, task.updatedAt, null, task.sourceInboxId ?? null, task.sourceGoalId ?? null, task.emailSource?.provider ?? null, task.emailSource?.messageId ?? null, task.calendarSource?.provider ?? null, task.calendarSource?.eventId ?? null)
    return task
  }

  addCalendarPrepTask(input: {
    title: string
    notes?: string
    dueDate?: string | null
    priority?: PlanTaskPriority
    calendarSource: CalendarTaskSource
  }): { task: PlanTask; created: boolean } {
    const source = normalizeCalendarTaskSource(input.calendarSource)
    this.db.exec('BEGIN IMMEDIATE')
    try {
      const existing = this.db.prepare('SELECT * FROM tasks WHERE source_calendar_provider = ? AND source_calendar_event_id = ?').get(source.provider, source.eventId) as TaskRow | undefined
      if (existing) {
        this.db.exec('COMMIT')
        return { task: this.attachTaskExports([taskFromRow(existing)])[0]!, created: false }
      }
      const task = this.addTask({ ...input, calendarSource: source })
      this.db.exec('COMMIT')
      return { task, created: true }
    } catch (error) {
      try { this.db.exec('ROLLBACK') } catch { /* Keep the original failure. */ }
      throw error
    }
  }

  addEmailFollowupTask(input: {
    title: string
    notes?: string
    dueDate?: string | null
    remindAt?: string | null
    priority?: PlanTaskPriority
    emailSource: EmailTaskSource
  }): { task: PlanTask; created: boolean } {
    const source = normalizeEmailTaskSource(input.emailSource)
    this.db.exec('BEGIN IMMEDIATE')
    try {
      const existing = this.db.prepare('SELECT * FROM tasks WHERE source_email_provider = ? AND source_email_message_id = ? ORDER BY created_at, id LIMIT 1').get(source.provider, source.messageId) as TaskRow | undefined
      if (existing) {
        this.db.exec('COMMIT')
        return { task: this.attachTaskExports([taskFromRow(existing)])[0]!, created: false }
      }
      const task = this.addTask({ ...input, emailSource: source })
      this.db.exec('COMMIT')
      return { task, created: true }
    } catch (error) {
      try { this.db.exec('ROLLBACK') } catch { /* Keep the original failure. */ }
      throw error
    }
  }

  updateTask(id: string, patch: { title?: string; notes?: string; dueDate?: string | null; remindAt?: string | null; priority?: PlanTaskPriority; status?: PlanTaskStatus }): PlanTask {
    const current = this.getTask(id)
    const status = patch.status ?? current.status
    if (!['open', 'done', 'cancelled'].includes(status)) throw new Error('Choose a valid task status.')
    const task: PlanTask = { ...current, title: patch.title === undefined ? current.title : patch.title.trim().slice(0, 240), notes: patch.notes === undefined ? current.notes : patch.notes.trim().slice(0, 2000), dueDate: patch.dueDate === undefined ? current.dueDate : normalizeDate(patch.dueDate), remindAt: patch.remindAt === undefined ? current.remindAt : normalizeReminderAt(patch.remindAt), priority: patch.priority ?? current.priority, status, updatedAt: new Date().toISOString(), completedAt: status === 'done' ? (current.completedAt ?? new Date().toISOString()) : null }
    if (!task.title) throw new Error('A task needs a title.')
    const shouldResetReminder = task.remindAt !== current.remindAt || (status === 'open' && current.status !== 'open')
    const priorReminder = this.db.prepare('SELECT reminder_notified_at FROM tasks WHERE id = ?').get(id) as { reminder_notified_at: string | null }
    const reminderNotifiedAt = shouldResetReminder ? null : priorReminder.reminder_notified_at
    this.db.prepare('UPDATE tasks SET title = ?, notes = ?, due_date = ?, remind_at = ?, reminder_notified_at = ?, priority = ?, status = ?, updated_at = ?, completed_at = ? WHERE id = ?').run(task.title, task.notes, task.dueDate, task.remindAt, reminderNotifiedAt, task.priority, task.status, task.updatedAt, task.completedAt, task.id)
    return task
  }

  listDueReminders(through = new Date().toISOString()): PendingTaskReminder[] {
    const rows = this.db.prepare("SELECT id, title, remind_at FROM tasks WHERE status = 'open' AND remind_at IS NOT NULL AND remind_at <= ? AND reminder_notified_at IS NULL ORDER BY remind_at LIMIT 50").all(through) as Array<{ id: string; title: string; remind_at: string }>
    return rows.map((row) => ({ id: row.id, title: row.title, remindAt: row.remind_at }))
  }

  markReminderNotified(id: string, remindAt: string, notifiedAt = new Date().toISOString()): boolean {
    const result = this.db.prepare("UPDATE tasks SET reminder_notified_at = ? WHERE id = ? AND status = 'open' AND remind_at = ? AND reminder_notified_at IS NULL").run(notifiedAt, id, remindAt)
    return result.changes > 0
  }

  getTask(id: string): PlanTask {
    const row = this.db.prepare('SELECT * FROM tasks WHERE id = ?').get(id) as TaskRow | undefined
    if (!row) throw new Error('That task no longer exists.')
    return this.attachTaskExports([taskFromRow(row)])[0]!
  }

  getTaskExport(taskId: string, provider: TaskExportProvider, taskListId: string): TaskExportRecord | undefined {
    const row = this.db.prepare('SELECT * FROM task_exports WHERE task_id = ? AND provider = ? AND task_list_id = ?').get(taskId, provider, taskListId) as TaskExportRow | undefined
    return row ? taskExportFromRow(row) : undefined
  }

  beginTaskExport(taskId: string, provider: TaskExportProvider, taskListId: string, expectedUpdatedAt: string): { task: PlanTask; export: TaskExportRecord; alreadySent: boolean } {
    validateTaskExportTarget(provider, taskListId)
    this.db.exec('BEGIN IMMEDIATE')
    try {
      const task = this.getTask(taskId)
      if (task.status !== 'open') throw new Error('Only an open local Today task can be sent to a connected task service.')
      if (task.updatedAt !== expectedUpdatedAt) throw new Error('This local task changed after approval was requested. Review it and approve the send again.')
      const existing = this.getTaskExport(taskId, provider, taskListId)
      if (existing?.status === 'sent') {
        this.db.exec('COMMIT')
        return { task, export: existing, alreadySent: true }
      }
      if (existing && (existing.status === 'sending' || existing.status === 'uncertain')) {
        throw new Error('A previous send may already have created this remote task. Check the destination list, then ask Mike Assist to clear the retry guard before trying again.')
      }
      const updatedAt = new Date().toISOString()
      if (existing) {
        this.db.prepare("UPDATE task_exports SET status = 'sending', remote_task_id = NULL, updated_at = ? WHERE task_id = ? AND provider = ? AND task_list_id = ?").run(updatedAt, taskId, provider, taskListId)
      } else {
        this.db.prepare("INSERT INTO task_exports (task_id, provider, task_list_id, status, remote_task_id, updated_at) VALUES (?, ?, ?, 'sending', NULL, ?)").run(taskId, provider, taskListId, updatedAt)
      }
      this.db.exec('COMMIT')
      return { task, export: { provider, taskListId, status: 'sending', updatedAt, syncStatus: 'idle' }, alreadySent: false }
    } catch (error) {
      try { this.db.exec('ROLLBACK') } catch { /* Keep the original failure. */ }
      throw error
    }
  }

  finishTaskExport(taskId: string, provider: TaskExportProvider, taskListId: string, status: Exclude<TaskExportStatus, 'sending'>, remoteTaskId?: string, syncSnapshot?: TaskExportSyncSnapshot): void {
    if (status === 'sent' && (!remoteTaskId || remoteTaskId.length > 512)) throw new Error('The task service returned an invalid remote task ID.')
    if (syncSnapshot && (!syncSnapshot.localUpdatedAt || (syncSnapshot.remoteEtag !== undefined && (!syncSnapshot.remoteEtag || syncSnapshot.remoteEtag.length > 512)))) throw new Error('The task service returned invalid sync version details.')
    const result = this.db.prepare('UPDATE task_exports SET status = ?, remote_task_id = ?, updated_at = ?, sync_status = ?, synced_local_updated_at = ?, synced_title = ?, synced_notes = ?, synced_due_date = ?, synced_priority = ?, remote_etag = ? WHERE task_id = ? AND provider = ? AND task_list_id = ? AND status = ?')
      .run(status, status === 'sent' ? (remoteTaskId ?? null) : null, new Date().toISOString(), 'idle', syncSnapshot?.localUpdatedAt ?? null, syncSnapshot?.title ?? null, syncSnapshot?.notes ?? null, syncSnapshot?.dueDate ?? null, syncSnapshot?.priority ?? null, syncSnapshot?.remoteEtag ?? null, taskId, provider, taskListId, 'sending')
    if (result.changes === 0) throw new Error('The local task send record changed before it could be updated.')
  }

  beginTaskExportSync(taskId: string, provider: TaskExportProvider, taskListId: string, expectedUpdatedAt: string): { task: PlanTask; export: TaskExportRecord } {
    validateTaskExportTarget(provider, taskListId)
    this.db.exec('BEGIN IMMEDIATE')
    try {
      const task = this.getTask(taskId)
      if (task.status !== 'open') throw new Error('Only an open local Today task can update a linked task.')
      if (task.updatedAt !== expectedUpdatedAt) throw new Error('This local task changed after update approval was requested. Review it and approve again.')
      const prior = this.getTaskExport(taskId, provider, taskListId)
      if (!prior || prior.status !== 'sent' || !prior.remoteTaskId) throw new Error('This local task has no confirmed remote link to update.')
      if (!prior.syncedLocalUpdatedAt || !prior.remoteEtag || prior.syncedTitle === undefined || prior.syncedNotes === undefined || (provider === 'microsoft_todo' && prior.syncedPriority === undefined)) {
        throw new Error('This task link predates safe sync tracking or the provider returned no version tag. It can stay a one-time copy, but it cannot be updated safely.')
      }
      if (prior.syncStatus === 'sending' || prior.syncStatus === 'uncertain') throw new Error('A previous update may already have applied. Check the destination task and clear the sync retry guard before trying again.')
      if (!taskDiffersFromExportBaseline(task, provider, prior)) throw new Error('This local task has no changes since the last confirmed update.')
      const updatedAt = new Date().toISOString()
      const result = this.db.prepare("UPDATE task_exports SET sync_status = 'sending', updated_at = ? WHERE task_id = ? AND provider = ? AND task_list_id = ? AND status = 'sent' AND sync_status IN ('idle', 'failed')")
        .run(updatedAt, taskId, provider, taskListId)
      if (result.changes === 0) throw new Error('This linked task is already being updated. Refresh and try again.')
      this.db.exec('COMMIT')
      return { task, export: { ...prior, syncStatus: 'sending', updatedAt } }
    } catch (error) {
      try { this.db.exec('ROLLBACK') } catch { /* Keep the original failure. */ }
      throw error
    }
  }

  finishTaskExportSync(taskId: string, provider: TaskExportProvider, taskListId: string, status: Exclude<TaskExportSyncStatus, 'sending'>, snapshot?: TaskExportSyncSnapshot): void {
    if (status === 'idle' && (!snapshot || !snapshot.localUpdatedAt || (snapshot.remoteEtag !== undefined && (!snapshot.remoteEtag || snapshot.remoteEtag.length > 512)))) throw new Error('The provider returned invalid sync version details.')
    const result = this.db.prepare("UPDATE task_exports SET sync_status = ?, updated_at = ?, synced_local_updated_at = CASE WHEN ? = 1 THEN ? ELSE synced_local_updated_at END, synced_title = CASE WHEN ? = 1 THEN ? ELSE synced_title END, synced_notes = CASE WHEN ? = 1 THEN ? ELSE synced_notes END, synced_due_date = CASE WHEN ? = 1 THEN ? ELSE synced_due_date END, synced_priority = CASE WHEN ? = 1 THEN ? ELSE synced_priority END, remote_etag = CASE WHEN ? = 1 THEN ? ELSE remote_etag END WHERE task_id = ? AND provider = ? AND task_list_id = ? AND status = 'sent' AND sync_status = 'sending'")
      .run(status, new Date().toISOString(), snapshot ? 1 : 0, snapshot?.localUpdatedAt ?? null, snapshot ? 1 : 0, snapshot?.title ?? null, snapshot ? 1 : 0, snapshot?.notes ?? null, snapshot ? 1 : 0, snapshot?.dueDate ?? null, snapshot ? 1 : 0, snapshot?.priority ?? null, snapshot ? 1 : 0, snapshot?.remoteEtag ?? null, taskId, provider, taskListId)
    if (result.changes === 0) throw new Error('The linked task sync record changed before it could be updated.')
  }

  clearTaskExportSyncRetryGuard(taskId: string, provider: TaskExportProvider, taskListId: string): void {
    const result = this.db.prepare("UPDATE task_exports SET sync_status = 'idle', updated_at = ? WHERE task_id = ? AND provider = ? AND task_list_id = ? AND status = 'sent' AND sync_status = 'uncertain'").run(new Date().toISOString(), taskId, provider, taskListId)
    if (result.changes === 0) throw new Error('There is no uncertain linked-task update to clear for that task and destination.')
  }

  clearTaskExportRetryGuard(taskId: string, provider: TaskExportProvider, taskListId: string): void {
    const result = this.db.prepare("DELETE FROM task_exports WHERE task_id = ? AND provider = ? AND task_list_id = ? AND status IN ('sending', 'uncertain')").run(taskId, provider, taskListId)
    if (result.changes === 0) throw new Error('There is no uncertain send attempt to clear for that task and destination.')
  }

  capture(text: string): InboxItem {
    const clean = text.trim().slice(0, 2000)
    if (!clean) throw new Error('Capture something before saving it to the inbox.')
    const item: InboxItem = { id: randomUUID(), text: clean, createdAt: new Date().toISOString(), convertedTaskId: null, dismissedAt: null }
    this.db.prepare('INSERT INTO inbox (id, text, created_at, converted_task_id, dismissed_at) VALUES (?, ?, ?, NULL, NULL)').run(item.id, item.text, item.createdAt)
    return item
  }

  convertInbox(id: string, input?: { title?: string; dueDate?: string | null; priority?: PlanTaskPriority }): PlanTask {
    this.db.exec('BEGIN IMMEDIATE')
    try {
      const row = this.db.prepare('SELECT * FROM inbox WHERE id = ?').get(id) as InboxRow | undefined
      if (!row || row.dismissed_at || row.converted_task_id) throw new Error('That inbox item is no longer active.')
      const task = this.addTask({ title: input?.title ?? row.text, dueDate: input?.dueDate, priority: input?.priority, sourceInboxId: id })
      const result = this.db.prepare('UPDATE inbox SET converted_task_id = ? WHERE id = ? AND dismissed_at IS NULL AND converted_task_id IS NULL').run(task.id, id)
      if (result.changes === 0) throw new Error('That inbox item is no longer active.')
      this.db.exec('COMMIT')
      return task
    } catch (error) {
      try { this.db.exec('ROLLBACK') } catch { /* Keep the original failure. */ }
      throw error
    }
  }

  dismissInbox(id: string): void {
    const result = this.db.prepare('UPDATE inbox SET dismissed_at = ? WHERE id = ? AND dismissed_at IS NULL AND converted_task_id IS NULL').run(new Date().toISOString(), id)
    if (result.changes === 0) throw new Error('That inbox item is no longer active.')
  }

  async backupTo(file: string): Promise<void> { await mkdir(path.dirname(file), { recursive: true }); await backup(this.db, file) }
  close(): void { if (!this.closed) { this.db.close(); this.closed = true } }
  private get dbPath(): string { const row = this.db.prepare('PRAGMA database_list').get() as { file?: string } | undefined; return row?.file ? path.dirname(row.file) : process.cwd() }

  private attachTaskExports(tasks: PlanTask[]): PlanTask[] {
    if (!tasks.length) return tasks
    const exports = this.db.prepare('SELECT * FROM task_exports ORDER BY updated_at DESC').all() as unknown as TaskExportRow[]
    const byTask = new Map<string, TaskExportRecord[]>()
    for (const row of exports) {
      const values = byTask.get(row.task_id) ?? []
      values.push(taskExportFromRow(row))
      byTask.set(row.task_id, values)
    }
    return tasks.map((task) => ({ ...task, taskExports: byTask.get(task.id) ?? [] }))
  }
}

function taskFromRow(row: TaskRow): PlanTask { return { id: row.id, title: row.title, notes: row.notes, dueDate: row.due_date, remindAt: row.remind_at, priority: row.priority, status: row.status, createdAt: row.created_at, updatedAt: row.updated_at, completedAt: row.completed_at, sourceInboxId: row.source_inbox_id ?? undefined, sourceGoalId: row.source_goal_id ?? undefined, emailSource: isEmailTaskProvider(row.source_email_provider) && row.source_email_message_id ? { provider: row.source_email_provider, messageId: row.source_email_message_id } : undefined, calendarSource: isCalendarTaskProvider(row.source_calendar_provider) && row.source_calendar_event_id ? { provider: row.source_calendar_provider, eventId: row.source_calendar_event_id } : undefined } }
function inboxFromRow(row: InboxRow): InboxItem { return { id: row.id, text: row.text, createdAt: row.created_at, convertedTaskId: row.converted_task_id, dismissedAt: row.dismissed_at } }
function normalizeEmailTaskSource(source: EmailTaskSource): EmailTaskSource {
  if (!isEmailTaskProvider(source.provider)) throw new Error('Choose Gmail or Outlook as the email source.')
  const messageId = source.messageId.trim()
  if (!messageId || messageId.length > 512 || /[\u0000-\u001f\u007f]/.test(messageId)) throw new Error('Provide a valid email message ID.')
  return { provider: source.provider, messageId }
}
function normalizeCalendarTaskSource(source: CalendarTaskSource): CalendarTaskSource {
  if (!isCalendarTaskProvider(source.provider)) throw new Error('Choose Google Calendar or Outlook Calendar as the event source.')
  const eventId = source.eventId.trim()
  if (!eventId || eventId.length > 1_024 || /[\u0000-\u001f\u007f]/.test(eventId)) throw new Error('Provide a valid calendar event ID.')
  return { provider: source.provider, eventId }
}
function isEmailTaskProvider(value: string | null): value is EmailTaskProvider { return value === 'gmail' || value === 'outlook' }
function isCalendarTaskProvider(value: string | null): value is CalendarTaskProvider { return value === 'google_calendar' || value === 'microsoft_calendar' }
function taskExportFromRow(row: TaskExportRow): TaskExportRecord { return { provider: row.provider, taskListId: row.task_list_id, status: row.status, ...(row.remote_task_id ? { remoteTaskId: row.remote_task_id } : {}), updatedAt: row.updated_at, syncStatus: row.sync_status, ...(row.synced_local_updated_at ? { syncedLocalUpdatedAt: row.synced_local_updated_at } : {}), ...(row.synced_title !== null ? { syncedTitle: row.synced_title } : {}), ...(row.synced_notes !== null ? { syncedNotes: row.synced_notes } : {}), ...(row.synced_local_updated_at ? { syncedDueDate: row.synced_due_date } : {}), ...(row.synced_priority ? { syncedPriority: row.synced_priority } : {}), ...(row.remote_etag ? { remoteEtag: row.remote_etag } : {}) } }
function taskDiffersFromExportBaseline(task: PlanTask, provider: TaskExportProvider, baseline: TaskExportRecord): boolean {
  if (!baseline.syncedLocalUpdatedAt || baseline.syncedTitle === undefined || baseline.syncedNotes === undefined) return false
  const titleLimit = provider === 'google_tasks' ? 1_024 : 240
  const cleanTitle = task.title.replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, titleLimit)
  const cleanNotes = task.notes.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, ' ').trim().slice(0, 4_000)
  return cleanTitle !== baseline.syncedTitle || cleanNotes !== baseline.syncedNotes || task.dueDate !== (baseline.syncedDueDate ?? null) ||
    (provider === 'microsoft_todo' && baseline.syncedPriority !== undefined && task.priority !== baseline.syncedPriority)
}
function validateTaskExportTarget(provider: TaskExportProvider, taskListId: string): void {
  if (provider !== 'google_tasks' && provider !== 'microsoft_todo') throw new Error('Choose Google Tasks or Microsoft To Do as the destination.')
  if (!taskListId || taskListId.length > 512 || /[\u0000-\u001f\u007f]/.test(taskListId)) throw new Error('Choose a valid task list.')
}
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
function localDate(): string { const date = new Date(); const offset = date.getTimezoneOffset(); return new Date(date.getTime() - offset * 60_000).toISOString().slice(0, 10) }
