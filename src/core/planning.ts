import { randomUUID } from 'node:crypto'
import { backup, DatabaseSync } from 'node:sqlite'
import { mkdir } from 'node:fs/promises'
import path from 'node:path'
import { openSQLiteDatabase } from './sqlite'
import type { AreaColorName, AreaIconName, InboxItem, PlanTask, PlanTaskPriority, PlanTaskStatus, TaskArea, TaskProject, TaskRecurrenceInput, TaskRecurrenceRule, TaskWorkflowStage, TodaySnapshot } from '../shared/types'
import { assertDateOnly } from '../shared/date-only'
import { getNextRecurrenceDate, normalizeRecurrenceRule } from './recurrence'

interface TaskRow {
  id: string
  title: string
  notes: string
  due_date: string | null
  planned_date: string | null
  day_order: number | null
  scheduled_start: string | null
  duration_minutes: number | null
  project_id: string | null
  workflow_stage: string
  remind_at: string | null
  reminder_notified_at: string | null
  priority: PlanTaskPriority
  status: PlanTaskStatus
  created_at: string
  updated_at: string
  completed_at: string | null
  parent_task_id: string | null
  source_inbox_id: string | null
  recurrence_rule: string | null
  recurrence_date: string | null
  recurrence_series_id: string | null
}

interface InboxRow {
  id: string
  text: string
  created_at: string
  converted_task_id: string | null
  dismissed_at: string | null
}

export interface PendingTaskReminder { id: string; title: string; remindAt: string }
export interface ProjectWorkspace { areas: TaskArea[]; projects: TaskProject[]; tasks: PlanTask[] }

/** Local tasks and a quick capture inbox backed by the existing planning.sqlite file. */
export class PlanningStore {
  private db: DatabaseSync
  private closed = false

  constructor(private readonly file: string) { this.db = openSQLiteDatabase(file) }

  /** Shared SQLite handle for feature stores that live in the same backup boundary. */
  get database(): DatabaseSync {
    if (this.closed) throw new Error('Task data is not open.')
    return this.db
  }

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
        planned_date TEXT, day_order INTEGER, scheduled_start TEXT, duration_minutes INTEGER,
        project_id TEXT, workflow_stage TEXT NOT NULL DEFAULT 'next',
        remind_at TEXT, reminder_notified_at TEXT,
        priority TEXT NOT NULL CHECK (priority IN ('low', 'normal', 'high')),
        status TEXT NOT NULL CHECK (status IN ('open', 'done', 'cancelled')),
        created_at TEXT NOT NULL, updated_at TEXT NOT NULL, completed_at TEXT,
        parent_task_id TEXT, source_inbox_id TEXT,
        recurrence_rule TEXT, recurrence_date TEXT, recurrence_series_id TEXT
      );
      CREATE TABLE IF NOT EXISTS inbox (
        id TEXT PRIMARY KEY, text TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL DEFAULT '',
        converted_task_id TEXT, dismissed_at TEXT
      );
      CREATE TABLE IF NOT EXISTS task_areas (
        id TEXT PRIMARY KEY, name TEXT NOT NULL, icon TEXT NOT NULL CHECK (icon IN ('briefcase', 'home', 'book', 'leaf')), color TEXT NOT NULL CHECK (color IN ('teal', 'blue', 'amber', 'violet')),
        sort_order INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS task_projects (
        id TEXT PRIMARY KEY, name TEXT NOT NULL, description TEXT NOT NULL DEFAULT '',
        target_date TEXT, area_id TEXT, goal_id TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
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
    if (!names.has('planned_date')) this.db.exec('ALTER TABLE tasks ADD COLUMN planned_date TEXT')
    if (!names.has('day_order')) this.db.exec('ALTER TABLE tasks ADD COLUMN day_order INTEGER')
    if (!names.has('scheduled_start')) this.db.exec('ALTER TABLE tasks ADD COLUMN scheduled_start TEXT')
    if (!names.has('duration_minutes')) this.db.exec('ALTER TABLE tasks ADD COLUMN duration_minutes INTEGER')
    if (!names.has('project_id')) this.db.exec('ALTER TABLE tasks ADD COLUMN project_id TEXT')
    if (!names.has('workflow_stage')) this.db.exec("ALTER TABLE tasks ADD COLUMN workflow_stage TEXT NOT NULL DEFAULT 'next'")
    if (!names.has('recurrence_rule')) this.db.exec('ALTER TABLE tasks ADD COLUMN recurrence_rule TEXT')
    if (!names.has('recurrence_date')) this.db.exec('ALTER TABLE tasks ADD COLUMN recurrence_date TEXT')
    if (!names.has('recurrence_series_id')) this.db.exec('ALTER TABLE tasks ADD COLUMN recurrence_series_id TEXT')
    const inboxColumns = this.db.prepare('PRAGMA table_info(inbox)').all() as Array<{ name: string }>
    if (!inboxColumns.some((column) => column.name === 'updated_at')) this.db.exec("ALTER TABLE inbox ADD COLUMN updated_at TEXT NOT NULL DEFAULT ''")
    this.db.exec("UPDATE inbox SET updated_at = created_at WHERE updated_at = ''")
    const projectColumns = this.db.prepare('PRAGMA table_info(task_projects)').all() as Array<{ name: string }>
    if (!projectColumns.some((column) => column.name === 'goal_id')) this.db.exec('ALTER TABLE task_projects ADD COLUMN goal_id TEXT')
    this.db.exec('CREATE INDEX IF NOT EXISTS tasks_planned_day ON tasks(planned_date, day_order, status)')
    this.db.exec('CREATE INDEX IF NOT EXISTS tasks_project_stage ON tasks(project_id, workflow_stage, status)')
    this.db.exec('CREATE INDEX IF NOT EXISTS projects_area ON task_projects(area_id, name)')
    this.db.exec('CREATE UNIQUE INDEX IF NOT EXISTS tasks_recurrence_series_date ON tasks(recurrence_series_id, recurrence_date) WHERE recurrence_series_id IS NOT NULL')
  }

  projectWorkspace(): ProjectWorkspace {
    const areas = this.db.prepare('SELECT * FROM task_areas ORDER BY sort_order, name COLLATE NOCASE, id').all() as Array<{ id: string; name: string; icon: string; color: string; sort_order: number; created_at: string }>
    const projects = this.db.prepare('SELECT * FROM task_projects ORDER BY area_id IS NULL, area_id, name COLLATE NOCASE, id').all() as Array<{ id: string; name: string; description: string; target_date: string | null; area_id: string | null; goal_id: string | null; created_at: string; updated_at: string }>
    const tasks = this.db.prepare('SELECT * FROM tasks ORDER BY status, due_date IS NULL, due_date, created_at DESC').all() as unknown as TaskRow[]
    return {
      areas: areas.map((row) => ({ id: row.id, name: row.name, icon: isAreaIcon(row.icon) ? row.icon : 'briefcase', color: isAreaColor(row.color) ? row.color : 'teal', sortOrder: row.sort_order, createdAt: row.created_at })),
      projects: projects.map((row) => ({ id: row.id, name: row.name, description: row.description, targetDate: row.target_date, areaId: row.area_id, goalId: row.goal_id ?? null, createdAt: row.created_at, updatedAt: row.updated_at })),
      tasks: tasks.map(taskFromRow)
    }
  }

  createArea(input: { name: string; icon: AreaIconName; color: AreaColorName }): TaskArea {
    const name = normalizeName(input.name, 'Area')
    if (!isAreaIcon(input.icon) || !isAreaColor(input.color)) throw new Error('Choose a valid Area icon and color.')
    const sortOrder = Number((this.db.prepare('SELECT COALESCE(MAX(sort_order), -1) + 1 AS next_order FROM task_areas').get() as { next_order: number }).next_order)
    const area: TaskArea = { id: randomUUID(), name, icon: input.icon, color: input.color, sortOrder, createdAt: new Date().toISOString() }
    this.db.prepare('INSERT INTO task_areas (id, name, icon, color, sort_order, created_at) VALUES (?, ?, ?, ?, ?, ?)').run(area.id, area.name, area.icon, area.color, area.sortOrder, area.createdAt)
    return area
  }

  createProject(input: { name: string; description?: string; targetDate?: string | null; areaId?: string | null; goalId?: string | null }): TaskProject {
    const name = normalizeName(input.name, 'Project')
    const areaId = input.areaId ?? null
    const goalId = input.goalId ?? null
    if (areaId !== null) this.getArea(areaId)
    if (goalId !== null && !this.db.prepare('SELECT 1 FROM life_goals WHERE id = ?').get(goalId)) throw new Error('That goal no longer exists.')
    const now = new Date().toISOString()
    const project: TaskProject = { id: randomUUID(), name, description: (input.description ?? '').trim().slice(0, 1500), targetDate: normalizeDate(input.targetDate), areaId, goalId, createdAt: now, updatedAt: now }
    this.db.prepare('INSERT INTO task_projects (id, name, description, target_date, area_id, goal_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(project.id, project.name, project.description, project.targetDate, project.areaId, goalId, now, now)
    return project
  }

  updateProject(id: string, patch: { name?: string; description?: string; targetDate?: string | null; areaId?: string | null; goalId?: string | null }): TaskProject {
    const current = this.getProject(id)
    const areaId = patch.areaId === undefined ? current.areaId : patch.areaId
    const goalId = patch.goalId === undefined ? current.goalId ?? null : patch.goalId
    if (areaId !== null) this.getArea(areaId)
    if (goalId !== null && !this.db.prepare('SELECT 1 FROM life_goals WHERE id = ?').get(goalId)) throw new Error('That goal no longer exists.')
    const project: TaskProject = { ...current,
      name: patch.name === undefined ? current.name : normalizeName(patch.name, 'Project'),
      description: patch.description === undefined ? current.description : patch.description.trim().slice(0, 1500),
      targetDate: patch.targetDate === undefined ? current.targetDate : normalizeDate(patch.targetDate),
      areaId, goalId, updatedAt: new Date().toISOString()
    }
    this.db.prepare('UPDATE task_projects SET name = ?, description = ?, target_date = ?, area_id = ?, goal_id = ?, updated_at = ? WHERE id = ?').run(project.name, project.description, project.targetDate, project.areaId, project.goalId ?? null, project.updatedAt, id)
    return project
  }

  deleteProject(id: string): void {
    this.db.exec('BEGIN IMMEDIATE')
    try {
      this.getProject(id)
      this.db.prepare("UPDATE tasks SET project_id = NULL, workflow_stage = 'next', updated_at = ? WHERE project_id = ?").run(new Date().toISOString(), id)
      this.db.prepare('DELETE FROM task_projects WHERE id = ?').run(id)
      this.db.exec('COMMIT')
    } catch (error) {
      try { this.db.exec('ROLLBACK') } catch { /* Preserve the original failure. */ }
      throw error
    }
  }

  deleteArea(id: string): void {
    this.db.exec('BEGIN IMMEDIATE')
    try {
      this.getArea(id)
      this.db.prepare('UPDATE task_projects SET area_id = NULL, updated_at = ? WHERE area_id = ?').run(new Date().toISOString(), id)
      this.db.prepare('DELETE FROM task_areas WHERE id = ?').run(id)
      this.db.exec('COMMIT')
    } catch (error) {
      try { this.db.exec('ROLLBACK') } catch { /* Preserve the original failure. */ }
      throw error
    }
  }

  snapshot(date = localDate()): TodaySnapshot {
    assertDateOnly(date)
    const tasks = this.db.prepare(
      "SELECT * FROM tasks WHERE status = 'open' AND (due_date <= ? OR (due_date IS NULL AND (planned_date IS NULL OR planned_date <= ?))) ORDER BY CASE priority WHEN 'high' THEN 0 WHEN 'normal' THEN 1 ELSE 2 END, due_date IS NULL, due_date, created_at"
    ).all(date, date) as unknown as TaskRow[]
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

  listMyDay(date: string): PlanTask[] {
    assertDateOnly(date)
    const rows = this.db.prepare("SELECT * FROM tasks WHERE status = 'open' AND planned_date = ? ORDER BY day_order, created_at, id").all(date) as unknown as TaskRow[]
    return rows.map(taskFromRow)
  }

  planTaskForDay(id: string, date: string | null): PlanTask {
    if (typeof id !== 'string' || id.length === 0 || id.length > 80) throw new Error('Choose a valid task.')
    if (date !== null) assertDateOnly(date)
    this.db.exec('BEGIN IMMEDIATE')
    try {
      const current = this.getTask(id)
      if (current.status !== 'open') throw new Error('Only open tasks can be added to My Day.')
      if (current.plannedDate === date) { this.db.exec('COMMIT'); return current }
      const order = date === null ? null : Number((this.db.prepare("SELECT COALESCE(MAX(day_order), -1) + 1 AS next_order FROM tasks WHERE status = 'open' AND planned_date = ?").get(date) as { next_order: number }).next_order)
      this.db.prepare('UPDATE tasks SET planned_date = ?, day_order = ?, updated_at = ? WHERE id = ? AND status = \'open\'').run(date, order, new Date().toISOString(), id)
      this.db.exec('COMMIT')
      return this.getTask(id)
    } catch (error) {
      try { this.db.exec('ROLLBACK') } catch { /* Preserve the original failure. */ }
      throw error
    }
  }

  reorderMyDay(date: string, ids: string[]): PlanTask[] {
    assertDateOnly(date)
    if (ids.length > 500 || new Set(ids).size !== ids.length || ids.some((id) => typeof id !== 'string' || id.length > 80)) throw new Error('Choose a valid My Day order.')
    this.db.exec('BEGIN IMMEDIATE')
    try {
      const current = (this.db.prepare("SELECT id FROM tasks WHERE status = 'open' AND planned_date = ? ORDER BY day_order, created_at, id").all(date) as Array<{ id: string }>).map((row) => row.id)
      if (current.length !== ids.length || current.some((id) => !ids.includes(id))) throw new Error('My Day changed. Refresh and try again.')
      const update = this.db.prepare("UPDATE tasks SET day_order = ?, updated_at = ? WHERE id = ? AND status = 'open' AND planned_date = ?")
      const now = new Date().toISOString()
      ids.forEach((id, index) => update.run(index, now, id, date))
      this.db.exec('COMMIT')
      return this.listMyDay(date)
    } catch (error) {
      try { this.db.exec('ROLLBACK') } catch { /* Preserve the original failure. */ }
      throw error
    }
  }

  applySuggestedMyDayOrder(date: string, suggestedIds: string[]): PlanTask[] {
    assertDateOnly(date)
    if (suggestedIds.length > 30 || new Set(suggestedIds).size !== suggestedIds.length || suggestedIds.some((id) => typeof id !== 'string' || id.length > 80)) throw new Error('Choose a valid suggested plan.')
    this.db.exec('BEGIN IMMEDIATE')
    try {
      for (const id of suggestedIds) {
        const row = this.db.prepare("SELECT status FROM tasks WHERE id = ?").get(id) as { status: string } | undefined
        if (!row || row.status !== 'open') throw new Error('A suggested task is no longer open. Refresh and review the plan again.')
      }
      const current = (this.db.prepare("SELECT id FROM tasks WHERE status = 'open' AND planned_date = ? ORDER BY day_order, created_at, id").all(date) as Array<{ id: string }>).map((row) => row.id)
      const ordered = [...suggestedIds, ...current.filter((id) => !suggestedIds.includes(id))]
      const update = this.db.prepare("UPDATE tasks SET planned_date = ?, day_order = ?, updated_at = ? WHERE id = ? AND status = 'open'")
      const now = new Date().toISOString()
      ordered.forEach((id, index) => update.run(date, index, now, id))
      this.db.exec('COMMIT')
      return this.listMyDay(date)
    } catch (error) {
      try { this.db.exec('ROLLBACK') } catch { /* Preserve the original failure. */ }
      throw error
    }
  }

  /** Small, ordered task context for the assistant; never materialize the full task table. */
  listAssistantTasks(): PlanTask[] {
    const rows = this.db.prepare(
      "SELECT * FROM tasks WHERE status = 'open' ORDER BY CASE priority WHEN 'high' THEN 0 WHEN 'normal' THEN 1 ELSE 2 END, due_date IS NULL, due_date, created_at DESC LIMIT 30"
    ).all() as unknown as TaskRow[]
    return rows.map(taskFromRow)
  }

  addTask(input: {
    title: string
    notes?: string
    dueDate?: string | null
    plannedDate?: string | null
    scheduledStart?: string | null
    durationMinutes?: number | null
    remindAt?: string | null
    priority?: PlanTaskPriority
    parentTaskId?: string | null
    sourceInboxId?: string
    projectId?: string | null
    workflowStage?: TaskWorkflowStage
    recurrenceRule?: TaskRecurrenceInput | null
  }): PlanTask {
    const title = input.title.trim().slice(0, 240)
    if (!title) throw new Error('A task needs a title.')
    const priority = input.priority ?? 'normal'
    if (!isPriority(priority)) throw new Error('Choose a valid task priority.')
    const now = new Date().toISOString()
    const parentTaskId = input.parentTaskId ?? null
    const projectId = input.projectId ?? null
    const workflowStage = input.workflowStage ?? 'next'
    const dueDate = normalizeDate(input.dueDate)
    const scheduledStart = normalizeLocalDateTime(input.scheduledStart)
    const plannedDate = normalizeDate(input.plannedDate) ?? scheduledStart?.slice(0, 10) ?? null
    const durationMinutes = normalizeDuration(input.durationMinutes)
    if (input.recurrenceRule && parentTaskId !== null) throw new Error('Subtasks cannot repeat. Add the repeat rule to the parent task instead.')
    if (input.recurrenceRule && !dueDate) throw new Error('Add a due date before setting a repeat rule.')
    const recurrenceRule = input.recurrenceRule ? normalizeRecurrenceRule(input.recurrenceRule, dueDate!) : null
    const recurrenceSeriesId = recurrenceRule ? randomUUID() : null
    const recurrenceDate = recurrenceRule ? dueDate : null
    if (projectId !== null) this.getProject(projectId)
    if (!isWorkflowStage(workflowStage)) throw new Error('Choose a valid project stage.')
    const id = randomUUID()
    this.assertValidParentTask(id, parentTaskId)
    const task: PlanTask = {
      id, title, notes: (input.notes ?? '').trim().slice(0, 2_000), plannedDate, dayOrder: plannedDate ? Number((this.db.prepare("SELECT COALESCE(MAX(day_order), -1) + 1 AS next_order FROM tasks WHERE status = 'open' AND planned_date = ?").get(plannedDate) as { next_order: number }).next_order) : null, scheduledStart, durationMinutes, projectId, workflowStage,
      dueDate, remindAt: normalizeReminderAt(input.remindAt),
      priority, status: 'open', createdAt: now, updatedAt: now, completedAt: null,
      parentTaskId, sourceInboxId: input.sourceInboxId,
      recurrenceRule, recurrenceDate, recurrenceSeriesId
    }
    this.db.prepare(
      'INSERT INTO tasks (id, title, notes, due_date, planned_date, day_order, scheduled_start, duration_minutes, project_id, workflow_stage, remind_at, reminder_notified_at, priority, status, created_at, updated_at, completed_at, parent_task_id, source_inbox_id, recurrence_rule, recurrence_date, recurrence_series_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, ?, NULL, ?, ?, ?, ?, ?)'
    ).run(task.id, task.title, task.notes, task.dueDate, task.plannedDate ?? null, task.dayOrder ?? null, task.scheduledStart ?? null, task.durationMinutes ?? null, task.projectId ?? null, task.workflowStage ?? 'next', task.remindAt, task.priority, task.status, task.createdAt, task.updatedAt, task.parentTaskId, task.sourceInboxId ?? null, recurrenceRule ? JSON.stringify(recurrenceRule) : null, recurrenceDate, recurrenceSeriesId)
    return task
  }

  updateTask(id: string, patch: {
    title?: string
    notes?: string
    dueDate?: string | null
    scheduledStart?: string | null
    durationMinutes?: number | null
    remindAt?: string | null
    priority?: PlanTaskPriority
    status?: PlanTaskStatus
    parentTaskId?: string | null
    projectId?: string | null
    workflowStage?: TaskWorkflowStage
    recurrenceRule?: TaskRecurrenceInput | null
  }): PlanTask {
    this.db.exec('BEGIN IMMEDIATE')
    try {
    const current = this.getTask(id)
    const status = patch.status ?? current.status
    if (!isStatus(status)) throw new Error('Choose a valid task status.')
    const priority = patch.priority ?? current.priority
    if (!isPriority(priority)) throw new Error('Choose a valid task priority.')
    const parentTaskId = patch.parentTaskId === undefined ? current.parentTaskId : patch.parentTaskId
    const projectId = patch.projectId === undefined ? current.projectId ?? null : patch.projectId
    const workflowStage = patch.workflowStage ?? current.workflowStage ?? 'next'
    const dueDate = patch.dueDate === undefined ? current.dueDate : normalizeDate(patch.dueDate)
    const scheduledStart = patch.scheduledStart === undefined ? current.scheduledStart ?? null : normalizeLocalDateTime(patch.scheduledStart)
    const plannedDate = patch.scheduledStart !== undefined && scheduledStart ? scheduledStart.slice(0, 10) : current.plannedDate ?? null
    const dayOrder = plannedDate === (current.plannedDate ?? null) ? current.dayOrder ?? null : plannedDate ? Number((this.db.prepare("SELECT COALESCE(MAX(day_order), -1) + 1 AS next_order FROM tasks WHERE status = 'open' AND planned_date = ?").get(plannedDate) as { next_order: number }).next_order) : null
    const durationMinutes = patch.durationMinutes === undefined ? current.durationMinutes ?? null : normalizeDuration(patch.durationMinutes)
    if (projectId !== null) this.getProject(projectId)
    if (!isWorkflowStage(workflowStage)) throw new Error('Choose a valid project stage.')
    this.assertValidParentTask(id, parentTaskId)
    if (patch.recurrenceRule && parentTaskId !== null) throw new Error('Subtasks cannot repeat. Add the repeat rule to the parent task instead.')
    if (patch.recurrenceRule && !dueDate) throw new Error('Add a due date before setting a repeat rule.')
    const recurrenceRule = patch.recurrenceRule === undefined
      ? current.recurrenceRule
      : patch.recurrenceRule === null ? null : normalizeRecurrenceRule(
        patch.recurrenceRule,
        current.recurrenceDate ?? dueDate!,
        patch.recurrenceRule.frequency === 'monthly' && current.recurrenceRule?.frequency === 'monthly'
          ? current.recurrenceRule.monthDay
          : undefined
      )
    if (recurrenceRule && !dueDate) throw new Error('Add a due date before keeping a repeat rule.')
    if (recurrenceRule && parentTaskId !== null) throw new Error('Subtasks cannot repeat. Add the repeat rule to the parent task instead.')
    const recurrenceSeriesId = recurrenceRule ? current.recurrenceSeriesId ?? randomUUID() : null
    const recurrenceDate = recurrenceRule ? current.recurrenceDate ?? dueDate : null
    const task: PlanTask = {
      ...current,
      title: patch.title === undefined ? current.title : patch.title.trim().slice(0, 240),
      notes: patch.notes === undefined ? current.notes : patch.notes.trim().slice(0, 2_000),
      dueDate,
      plannedDate, dayOrder, scheduledStart, durationMinutes,
      remindAt: patch.remindAt === undefined ? current.remindAt : normalizeReminderAt(patch.remindAt),
      priority, status, parentTaskId, projectId, workflowStage, updatedAt: new Date().toISOString(),
      completedAt: status === 'done' ? (current.completedAt ?? new Date().toISOString()) : null,
      recurrenceRule, recurrenceDate, recurrenceSeriesId
    }
    if (!task.title) throw new Error('A task needs a title.')
    const resetReminder = task.remindAt !== current.remindAt || (status === 'open' && current.status !== 'open')
    const prior = this.db.prepare('SELECT reminder_notified_at FROM tasks WHERE id = ?').get(id) as { reminder_notified_at: string | null }
    const reminderNotifiedAt = resetReminder ? null : prior.reminder_notified_at
    this.db.prepare(
      'UPDATE tasks SET title = ?, notes = ?, due_date = ?, planned_date = ?, day_order = ?, scheduled_start = ?, duration_minutes = ?, remind_at = ?, reminder_notified_at = ?, priority = ?, status = ?, parent_task_id = ?, project_id = ?, workflow_stage = ?, updated_at = ?, completed_at = ?, recurrence_rule = ?, recurrence_date = ?, recurrence_series_id = ? WHERE id = ?'
    ).run(task.title, task.notes, task.dueDate, task.plannedDate ?? null, task.dayOrder ?? null, task.scheduledStart ?? null, task.durationMinutes ?? null, task.remindAt, reminderNotifiedAt, task.priority, task.status, task.parentTaskId, task.projectId ?? null, task.workflowStage ?? 'next', task.updatedAt, task.completedAt, recurrenceRule ? JSON.stringify(recurrenceRule) : null, recurrenceDate, recurrenceSeriesId, id)
    if (current.status !== 'done' && status === 'done') this.createNextOccurrence(task)
    this.db.exec('COMMIT')
    return task
    } catch (error) {
      try { this.db.exec('ROLLBACK') } catch { /* Preserve the original failure. */ }
      throw error
    }
  }

  skipTaskOccurrence(id: string): PlanTask {
    this.db.exec('BEGIN IMMEDIATE')
    try {
      const current = this.getTask(id)
      if (current.status !== 'open' || !current.recurrenceRule || !current.recurrenceDate || !current.recurrenceSeriesId) {
        throw new Error('Choose an open recurring task to skip.')
      }
      const task: PlanTask = { ...current, status: 'cancelled', updatedAt: new Date().toISOString() }
      this.db.prepare('UPDATE tasks SET status = ?, updated_at = ? WHERE id = ? AND status = ?').run('cancelled', task.updatedAt, id, 'open')
      this.createNextOccurrence(task)
      this.db.exec('COMMIT')
      return task
    } catch (error) {
      try { this.db.exec('ROLLBACK') } catch { /* Preserve the original failure. */ }
      throw error
    }
  }

  private createNextOccurrence(task: PlanTask): void {
    const rule = task.recurrenceRule
    const seriesId = task.recurrenceSeriesId
    const occurrenceDate = task.recurrenceDate
    if (!rule || !seriesId || !occurrenceDate) return
    const lowerBound = [occurrenceDate, task.dueDate ?? occurrenceDate, localDate()].sort().at(-1)!
    const nextDate = getNextRecurrenceDate(rule, lowerBound)
    if (!nextDate) return
    const exists = this.db.prepare('SELECT 1 AS found FROM tasks WHERE recurrence_series_id = ? AND recurrence_date = ?').get(seriesId, nextDate)
    if (exists) return
    const now = new Date().toISOString()
    this.db.prepare(
      'INSERT INTO tasks (id, title, notes, due_date, planned_date, day_order, project_id, workflow_stage, remind_at, reminder_notified_at, priority, status, created_at, updated_at, completed_at, parent_task_id, source_inbox_id, recurrence_rule, recurrence_date, recurrence_series_id) VALUES (?, ?, ?, ?, NULL, NULL, ?, ?, NULL, NULL, ?, ?, ?, ?, NULL, NULL, NULL, ?, ?, ?)'
    ).run(randomUUID(), task.title, task.notes, nextDate, task.projectId ?? null, task.workflowStage ?? 'next', task.priority, 'open', now, now, JSON.stringify(rule), nextDate, seriesId)
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

  getArea(id: string): TaskArea {
    const row = this.db.prepare('SELECT * FROM task_areas WHERE id = ?').get(id) as { id: string; name: string; icon: string; color: string; sort_order: number; created_at: string } | undefined
    if (!row) throw new Error('That Area no longer exists.')
    return { id: row.id, name: row.name, icon: isAreaIcon(row.icon) ? row.icon : 'briefcase', color: isAreaColor(row.color) ? row.color : 'teal', sortOrder: row.sort_order, createdAt: row.created_at }
  }

  getProject(id: string): TaskProject {
    const row = this.db.prepare('SELECT * FROM task_projects WHERE id = ?').get(id) as { id: string; name: string; description: string; target_date: string | null; area_id: string | null; goal_id: string | null; created_at: string; updated_at: string } | undefined
    if (!row) throw new Error('That project no longer exists.')
    return { id: row.id, name: row.name, description: row.description, targetDate: row.target_date, areaId: row.area_id, goalId: row.goal_id ?? null, createdAt: row.created_at, updatedAt: row.updated_at }
  }

  capture(text: string): InboxItem {
    const clean = text.trim().slice(0, 2_000)
    if (!clean) throw new Error('Capture something before saving it to the inbox.')
    const item: InboxItem = { id: randomUUID(), text: clean, createdAt: new Date().toISOString(), convertedTaskId: null, dismissedAt: null }
    this.db.prepare('INSERT INTO inbox (id, text, created_at, updated_at, converted_task_id, dismissed_at) VALUES (?, ?, ?, ?, NULL, NULL)').run(item.id, item.text, item.createdAt, item.createdAt)
    return item
  }

  convertInbox(id: string, input?: {
    title?: string
    notes?: string
    dueDate?: string | null
    scheduledStart?: string | null
    durationMinutes?: number | null
    remindAt?: string | null
    priority?: PlanTaskPriority
    projectId?: string | null
    workflowStage?: TaskWorkflowStage
    recurrenceRule?: TaskRecurrenceInput | null
  }): PlanTask {
    this.db.exec('BEGIN IMMEDIATE')
    try {
      const row = this.db.prepare('SELECT * FROM inbox WHERE id = ?').get(id) as InboxRow | undefined
      if (!row || row.dismissed_at || row.converted_task_id) throw new Error('That inbox item is no longer active.')
      const task = this.addTask({ ...input, title: input?.title ?? row.text, sourceInboxId: id })
      const result = this.db.prepare(
        'UPDATE inbox SET converted_task_id = ?, updated_at = ? WHERE id = ? AND dismissed_at IS NULL AND converted_task_id IS NULL'
      ).run(task.id, new Date().toISOString(), id)
      if (result.changes === 0) throw new Error('That inbox item is no longer active.')
      this.db.exec('COMMIT')
      return task
    } catch (error) {
      try { this.db.exec('ROLLBACK') } catch { /* Preserve the original failure. */ }
      throw error
    }
  }

  dismissInbox(id: string): void {
    const now = new Date().toISOString()
    const result = this.db.prepare(
      'UPDATE inbox SET dismissed_at = ?, updated_at = ? WHERE id = ? AND dismissed_at IS NULL AND converted_task_id IS NULL'
    ).run(now, now, id)
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
    id: row.id, title: row.title, notes: row.notes, dueDate: row.due_date, plannedDate: row.planned_date ?? null, dayOrder: row.day_order ?? null,
    scheduledStart: row.scheduled_start ?? null, durationMinutes: row.duration_minutes ?? null,
    projectId: row.project_id ?? null, workflowStage: normalizeWorkflowStage(row.workflow_stage),
    remindAt: row.remind_at, priority: row.priority, status: row.status,
    createdAt: row.created_at, updatedAt: row.updated_at, completedAt: row.completed_at,
    parentTaskId: row.parent_task_id, sourceInboxId: row.source_inbox_id ?? undefined,
    recurrenceRule: parseStoredRecurrenceRule(row.recurrence_rule, row.recurrence_date),
    recurrenceDate: row.recurrence_date ?? null,
    recurrenceSeriesId: row.recurrence_series_id ?? null
  }
}

function parseStoredRecurrenceRule(value: string | null, occurrenceDate: string | null): TaskRecurrenceRule | null {
  if (!value || !occurrenceDate) return null
  try {
    const parsed: unknown = JSON.parse(value)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null
    const rule = parsed as TaskRecurrenceRule
    return normalizeRecurrenceRule(rule, occurrenceDate, rule.monthDay)
  } catch { return null }
}

function inboxFromRow(row: InboxRow): InboxItem {
  return { id: row.id, text: row.text, createdAt: row.created_at, convertedTaskId: row.converted_task_id, dismissedAt: row.dismissed_at }
}

function isPriority(value: string): value is PlanTaskPriority { return value === 'low' || value === 'normal' || value === 'high' }
function isWorkflowStage(value: string): value is TaskWorkflowStage { return value === 'next' || value === 'in-progress' || value === 'waiting' }
function isAreaIcon(value: string): value is AreaIconName { return value === 'briefcase' || value === 'home' || value === 'book' || value === 'leaf' }
function isAreaColor(value: string): value is AreaColorName { return value === 'teal' || value === 'blue' || value === 'amber' || value === 'violet' }
function normalizeWorkflowStage(value: string): TaskWorkflowStage { return isWorkflowStage(value) ? value : 'next' }
function normalizeName(value: string, kind: string): string { const clean = value.trim().slice(0, 80); if (!clean) throw new Error(`${kind} needs a name.`); return clean }
function isStatus(value: string): value is PlanTaskStatus { return value === 'open' || value === 'done' || value === 'cancelled' }
function normalizeDate(value: string | null | undefined): string | null { return value ? assertDateOnly(value) : null }
function normalizeLocalDateTime(value: string | null | undefined): string | null {
  if (!value) return null
  if (!/^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d$/.test(value)) throw new Error('Choose a valid local calendar date and time.')
  assertDateOnly(value.slice(0, 10))
  return value
}
function normalizeDuration(value: number | null | undefined): number | null {
  if (value === null || value === undefined) return null
  if (!Number.isInteger(value) || value < 5 || value > 720) throw new Error('Task duration must be between 5 minutes and 12 hours.')
  return value
}
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
