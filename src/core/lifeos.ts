import { randomUUID } from 'node:crypto'
import type { DatabaseSync } from 'node:sqlite'
import type { CalendarEvent, CalendarSource, JournalEntry, LifeGoal, LifeGoalStatus, PersonalContext, PlanTask, PlanTaskPriority, RoutineTemplate, TaskArea, TaskProject, TaskRecurrenceInput } from '../shared/types'
import { assertDateOnly } from '../shared/date-only'
import type { PlanningStore } from './planning'

interface GoalRow { id: string; title: string; description: string; area_id: string | null; status: string; target_date: string | null; created_at: string; updated_at: string }
interface RoutineRow { id: string; name: string; description: string; area_id: string | null; project_id: string | null; payload: string; created_at: string; updated_at: string }
interface JournalRow { id: string; entry_date: string; title: string; content: string; area_id: string | null; goal_id: string | null; is_pinned: number; created_at: string; updated_at: string }

export interface LifeWorkspace { goals: LifeGoal[]; areas: TaskArea[]; projects: TaskProject[]; tasks: PlanTask[] }
export interface LifeGoalInput { id?: string; title: string; description?: string; areaId?: string | null; status?: LifeGoalStatus; targetDate?: string | null }
export interface RoutineInput { id?: string; name: string; description?: string; areaId?: string | null; projectId?: string | null; title: string; notes?: string; priority?: PlanTaskPriority; subtasks?: Array<{ title: string; notes?: string }>; recurrenceRule?: TaskRecurrenceInput | null }
export interface JournalInput { id?: string; entryDate: string; title?: string; content: string; areaId?: string | null; goalId?: string | null }
export interface CalendarEventInput { externalUid?: string | null; title: string; startsAt: string; endsAt: string; allDay?: boolean; location?: string }

const GOAL_STATUSES = new Set<LifeGoalStatus>(['active', 'paused', 'done'])
const PRIORITIES = new Set<PlanTaskPriority>(['low', 'normal', 'high'])

/** Life OS records share the task database so one backup includes the full workspace. */
export class LifeStore {
  constructor(private readonly db: DatabaseSync, private readonly planning: PlanningStore) {}

  init(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS life_goals (
        id TEXT PRIMARY KEY, title TEXT NOT NULL, description TEXT NOT NULL DEFAULT '', area_id TEXT,
        status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'paused', 'done')),
        target_date TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS routine_templates (
        id TEXT PRIMARY KEY, name TEXT NOT NULL, description TEXT NOT NULL DEFAULT '', area_id TEXT,
        project_id TEXT, payload TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS journal_entries (
        id TEXT PRIMARY KEY, entry_date TEXT NOT NULL, title TEXT NOT NULL DEFAULT '', content TEXT NOT NULL,
        area_id TEXT, goal_id TEXT, is_pinned INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS calendar_sources (
        id TEXT PRIMARY KEY, name TEXT NOT NULL, imported_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS calendar_events (
        id TEXT PRIMARY KEY, source_id TEXT NOT NULL, external_uid TEXT, title TEXT NOT NULL,
        starts_at TEXT NOT NULL, ends_at TEXT NOT NULL, all_day INTEGER NOT NULL DEFAULT 0, location TEXT NOT NULL DEFAULT ''
      );
      CREATE TABLE IF NOT EXISTS personal_context (
        key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS life_goals_area_status ON life_goals(area_id, status, target_date);
      CREATE INDEX IF NOT EXISTS journal_date ON journal_entries(entry_date DESC, updated_at DESC);
      CREATE INDEX IF NOT EXISTS calendar_events_range ON calendar_events(starts_at, ends_at);
      CREATE INDEX IF NOT EXISTS calendar_events_source ON calendar_events(source_id);
    `)
    const journalColumns = this.db.prepare('PRAGMA table_info(journal_entries)').all() as Array<{ name: string }>
    if (!journalColumns.some(column => column.name === 'is_pinned')) {
      this.db.exec('ALTER TABLE journal_entries ADD COLUMN is_pinned INTEGER NOT NULL DEFAULT 0')
    }
  }

  workspace(): LifeWorkspace {
    const project = this.planning.projectWorkspace()
    const rows = this.db.prepare('SELECT * FROM life_goals ORDER BY status, target_date IS NULL, target_date, title COLLATE NOCASE').all() as unknown as GoalRow[]
    return { goals: rows.map(goalFromRow), areas: project.areas, projects: project.projects, tasks: project.tasks }
  }

  saveGoal(input: LifeGoalInput): LifeGoal {
    const title = requiredText(input.title, 120, 'A goal needs a name.')
    const description = optionalText(input.description, 2000)
    const areaId = input.areaId ?? null
    if (areaId !== null) this.planning.getArea(validateId(areaId))
    const status = input.status ?? 'active'
    if (!GOAL_STATUSES.has(status)) throw new Error('Choose a valid goal status.')
    const targetDate = normalizeDate(input.targetDate)
    const now = new Date().toISOString()
    if (input.id) {
      const current = this.getGoal(input.id)
      const goal: LifeGoal = { ...current, title, description, areaId, status, targetDate, updatedAt: now }
      this.db.prepare('UPDATE life_goals SET title = ?, description = ?, area_id = ?, status = ?, target_date = ?, updated_at = ? WHERE id = ?')
        .run(title, description, areaId, status, targetDate, now, current.id)
      return goal
    }
    const goal: LifeGoal = { id: randomUUID(), title, description, areaId, status, targetDate, createdAt: now, updatedAt: now }
    this.db.prepare('INSERT INTO life_goals (id, title, description, area_id, status, target_date, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
      .run(goal.id, title, description, areaId, status, targetDate, now, now)
    return goal
  }

  deleteGoal(id: string): void {
    this.getGoal(id)
    this.db.exec('BEGIN IMMEDIATE')
    try {
      this.db.prepare('UPDATE task_projects SET goal_id = NULL, updated_at = ? WHERE goal_id = ?').run(new Date().toISOString(), id)
      this.db.prepare('UPDATE journal_entries SET goal_id = NULL WHERE goal_id = ?').run(id)
      this.db.prepare('DELETE FROM life_goals WHERE id = ?').run(id)
      this.db.exec('COMMIT')
    } catch (error) {
      try { this.db.exec('ROLLBACK') } catch { /* Preserve the original failure. */ }
      throw error
    }
  }

  listRoutines(): RoutineTemplate[] {
    return (this.db.prepare('SELECT * FROM routine_templates ORDER BY name COLLATE NOCASE').all() as unknown as RoutineRow[]).map(routineFromRow)
  }

  saveRoutine(input: RoutineInput): RoutineTemplate {
    const name = requiredText(input.name, 100, 'A routine needs a name.')
    const title = requiredText(input.title, 240, 'A routine needs a first task.')
    const description = optionalText(input.description, 1000)
    const notes = optionalText(input.notes, 2000)
    const areaId = input.areaId ? validateId(input.areaId) : null
    const projectId = input.projectId ? validateId(input.projectId) : null
    if (areaId) this.planning.getArea(areaId)
    if (projectId) this.planning.getProject(projectId)
    const priority = input.priority ?? 'normal'
    if (!PRIORITIES.has(priority)) throw new Error('Choose a valid task priority.')
    if (input.recurrenceRule) {
      if (!['daily', 'weekly', 'monthly'].includes(input.recurrenceRule.frequency)) throw new Error('Choose a valid recurrence rule.')
      if (input.recurrenceRule.frequency === 'weekly' && (!Array.isArray(input.recurrenceRule.weekdays) || !input.recurrenceRule.weekdays.length || input.recurrenceRule.weekdays.some((day) => !Number.isInteger(day) || day < 0 || day > 6))) throw new Error('Choose at least one valid weekday for a weekly routine.')
      if (input.recurrenceRule.frequency !== 'weekly' && input.recurrenceRule.weekdays !== undefined) throw new Error('Weekdays can only be set for a weekly routine.')
    }
    const subtasks = (input.subtasks ?? []).slice(0, 20).map((task) => ({
      title: requiredText(task.title, 240, 'A checklist item needs a title.'), notes: optionalText(task.notes, 2000)
    }))
    const payload = { title, notes, priority, subtasks, recurrenceRule: input.recurrenceRule ?? null }
    const now = new Date().toISOString()
    if (input.id) {
      const current = this.getRoutine(input.id)
      const template: RoutineTemplate = { ...current, name, description, areaId, projectId, ...payload, updatedAt: now }
      this.db.prepare('UPDATE routine_templates SET name = ?, description = ?, area_id = ?, project_id = ?, payload = ?, updated_at = ? WHERE id = ?')
        .run(name, description, areaId, projectId, JSON.stringify(payload), now, current.id)
      return template
    }
    const template: RoutineTemplate = { id: randomUUID(), name, description, areaId, projectId, ...payload, createdAt: now, updatedAt: now }
    this.db.prepare('INSERT INTO routine_templates (id, name, description, area_id, project_id, payload, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
      .run(template.id, name, description, areaId, projectId, JSON.stringify(payload), now, now)
    return template
  }

  deleteRoutine(id: string): void {
    const result = this.db.prepare('DELETE FROM routine_templates WHERE id = ?').run(validateId(id))
    if (!result.changes) throw new Error('That routine no longer exists.')
  }

  applyRoutine(id: string, plannedDate: string): PlanTask[] {
    const date = assertDateOnly(plannedDate)
    const routine = this.getRoutine(id)
    this.db.exec('BEGIN IMMEDIATE')
    try {
      const parent = this.planning.addTask({
        title: routine.title, notes: routine.notes, priority: routine.priority,
        projectId: routine.projectId, dueDate: routine.recurrenceRule ? date : null,
        recurrenceRule: routine.recurrenceRule
      })
      let order = Number((this.db.prepare("SELECT COALESCE(MAX(day_order), -1) + 1 AS next_order FROM tasks WHERE status = 'open' AND planned_date = ?").get(date) as { next_order: number }).next_order)
      this.db.prepare('UPDATE tasks SET planned_date = ?, day_order = ?, updated_at = ? WHERE id = ?').run(date, order++, new Date().toISOString(), parent.id)
      const created = [parent]
      for (const child of routine.subtasks) {
        const task = this.planning.addTask({ title: child.title, notes: child.notes, projectId: routine.projectId, parentTaskId: parent.id })
        this.db.prepare('UPDATE tasks SET planned_date = ?, day_order = ?, updated_at = ? WHERE id = ?').run(date, order++, new Date().toISOString(), task.id)
        created.push(task)
      }
      this.db.exec('COMMIT')
      return created.map((task) => this.planning.getTask(task.id))
    } catch (error) {
      try { this.db.exec('ROLLBACK') } catch { /* Preserve the original failure. */ }
      throw error
    }
  }

  listJournal(query = ''): JournalEntry[] {
    const term = query.trim().slice(0, 120)
    const rows = term
      ? this.db.prepare('SELECT * FROM journal_entries WHERE title LIKE ? OR content LIKE ? ORDER BY entry_date DESC, updated_at DESC LIMIT 250').all(`%${term}%`, `%${term}%`)
      : this.db.prepare('SELECT * FROM journal_entries ORDER BY entry_date DESC, updated_at DESC LIMIT 250').all()
    return (rows as unknown as JournalRow[]).map(journalFromRow)
  }

  saveJournal(input: JournalInput): JournalEntry {
    const entryDate = assertDateOnly(input.entryDate)
    const title = optionalText(input.title, 160)
    const content = requiredText(input.content, 20000, 'Write something before saving this note.')
    const areaId = input.areaId ? validateId(input.areaId) : null
    const goalId = input.goalId ? validateId(input.goalId) : null
    if (areaId) this.planning.getArea(areaId)
    if (goalId) this.getGoal(goalId)
    const now = new Date().toISOString()
    if (input.id) {
      const current = this.getJournal(input.id)
      const entry: JournalEntry = { ...current, entryDate, title, content, areaId, goalId, updatedAt: now }
      this.db.prepare('UPDATE journal_entries SET entry_date = ?, title = ?, content = ?, area_id = ?, goal_id = ?, updated_at = ? WHERE id = ?')
        .run(entryDate, title, content, areaId, goalId, now, current.id)
      return entry
    }
    const entry: JournalEntry = { id: randomUUID(), entryDate, title, content, areaId, goalId, createdAt: now, updatedAt: now }
    this.db.prepare('INSERT INTO journal_entries (id, entry_date, title, content, area_id, goal_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
      .run(entry.id, entryDate, title, content, areaId, goalId, now, now)
    return entry
  }

  deleteJournal(id: string): void {
    const result = this.db.prepare('DELETE FROM journal_entries WHERE id = ?').run(validateId(id))
    if (!result.changes) throw new Error('That note no longer exists.')
  }

  getPersonalContext(): PersonalContext {
    const rows = this.db.prepare('SELECT key, value, updated_at FROM personal_context').all() as Array<{ key: string; value: string; updated_at: string }>
    const values = new Map(rows.map((row) => [row.key, row]))
    const updatedAt = rows.reduce((latest, row) => row.updated_at > latest ? row.updated_at : latest, '')
    return {
      aboutMe: values.get('aboutMe')?.value ?? '',
      preferences: values.get('preferences')?.value ?? '',
      currentFocus: values.get('currentFocus')?.value ?? '',
      updatedAt
    }
  }

  savePersonalContext(input: Pick<PersonalContext, 'aboutMe' | 'preferences' | 'currentFocus'>): PersonalContext {
    const now = new Date().toISOString()
    const upsert = this.db.prepare('INSERT INTO personal_context (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at')
    upsert.run('aboutMe', optionalText(input.aboutMe, 2000), now)
    upsert.run('preferences', optionalText(input.preferences, 2000), now)
    upsert.run('currentFocus', optionalText(input.currentFocus, 2000), now)
    return this.getPersonalContext()
  }

  listCalendarSources(): CalendarSource[] {
    return (this.db.prepare('SELECT s.id, s.name, s.imported_at, COUNT(e.id) AS event_count FROM calendar_sources s LEFT JOIN calendar_events e ON e.source_id = s.id GROUP BY s.id ORDER BY s.name COLLATE NOCASE').all() as Array<{ id: string; name: string; imported_at: string; event_count: number }>).map((row) => ({ id: row.id, name: row.name, importedAt: row.imported_at, eventCount: row.event_count }))
  }

  replaceCalendarSource(id: string | null, name: string, events: CalendarEventInput[]): CalendarSource {
    const cleanName = requiredText(name, 120, 'A calendar needs a name.')
    if (events.length > 5000) throw new Error('This calendar has too many events to import at once.')
    const now = new Date().toISOString()
    const sourceId = id ? validateId(id) : randomUUID()
    if (id && !this.db.prepare('SELECT 1 FROM calendar_sources WHERE id = ?').get(sourceId)) throw new Error('That calendar source no longer exists.')
    const normalized = events.map((event) => normalizeCalendarEvent(event))
    this.db.exec('BEGIN IMMEDIATE')
    try {
      if (id) {
        this.db.prepare('UPDATE calendar_sources SET name = ?, imported_at = ? WHERE id = ?').run(cleanName, now, sourceId)
        this.db.prepare('DELETE FROM calendar_events WHERE source_id = ?').run(sourceId)
      } else {
        this.db.prepare('INSERT INTO calendar_sources (id, name, imported_at) VALUES (?, ?, ?)').run(sourceId, cleanName, now)
      }
      const insert = this.db.prepare('INSERT INTO calendar_events (id, source_id, external_uid, title, starts_at, ends_at, all_day, location) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
      for (const event of normalized) insert.run(randomUUID(), sourceId, event.externalUid, event.title, event.startsAt, event.endsAt, event.allDay ? 1 : 0, event.location)
      this.db.exec('COMMIT')
    } catch (error) {
      try { this.db.exec('ROLLBACK') } catch { /* Preserve the original failure. */ }
      throw error
    }
    return { id: sourceId, name: cleanName, importedAt: now, eventCount: normalized.length }
  }

  listCalendarEvents(start: string, end: string): CalendarEvent[] {
    const startDate = assertDateOnly(start)
    const endDate = assertDateOnly(end)
    if (endDate < startDate) throw new Error('Choose a valid calendar date range.')
    const from = new Date(`${startDate}T00:00:00`).toISOString()
    const to = new Date(`${endDate}T23:59:59.999`).toISOString()
    const rows = this.db.prepare('SELECT * FROM calendar_events WHERE starts_at <= ? AND ends_at >= ? ORDER BY starts_at, title COLLATE NOCASE').all(to, from) as Array<{ id: string; source_id: string; external_uid: string | null; title: string; starts_at: string; ends_at: string; all_day: number; location: string }>
    return rows.map((row) => ({ id: row.id, sourceId: row.source_id, externalUid: row.external_uid, title: row.title, startsAt: row.starts_at, endsAt: row.ends_at, allDay: row.all_day === 1, location: row.location }))
  }

  deleteCalendarSource(id: string): void {
    const sourceId = validateId(id)
    this.db.exec('BEGIN IMMEDIATE')
    try {
      const result = this.db.prepare('DELETE FROM calendar_sources WHERE id = ?').run(sourceId)
      if (!result.changes) throw new Error('That calendar source no longer exists.')
      this.db.prepare('DELETE FROM calendar_events WHERE source_id = ?').run(sourceId)
      this.db.exec('COMMIT')
    } catch (error) {
      try { this.db.exec('ROLLBACK') } catch { /* Preserve the original failure. */ }
      throw error
    }
  }

  private getGoal(id: string): LifeGoal {
    const row = this.db.prepare('SELECT * FROM life_goals WHERE id = ?').get(validateId(id)) as GoalRow | undefined
    if (!row) throw new Error('That goal no longer exists.')
    return goalFromRow(row)
  }

  private getRoutine(id: string): RoutineTemplate {
    const row = this.db.prepare('SELECT * FROM routine_templates WHERE id = ?').get(validateId(id)) as RoutineRow | undefined
    if (!row) throw new Error('That routine no longer exists.')
    return routineFromRow(row)
  }

  private getJournal(id: string): JournalEntry {
    const row = this.db.prepare('SELECT * FROM journal_entries WHERE id = ?').get(validateId(id)) as JournalRow | undefined
    if (!row) throw new Error('That note no longer exists.')
    return journalFromRow(row)
  }
}

function goalFromRow(row: GoalRow): LifeGoal {
  return { id: row.id, title: row.title, description: row.description, areaId: row.area_id, status: GOAL_STATUSES.has(row.status as LifeGoalStatus) ? row.status as LifeGoalStatus : 'active', targetDate: row.target_date, createdAt: row.created_at, updatedAt: row.updated_at }
}

function routineFromRow(row: RoutineRow): RoutineTemplate {
  let payload: Partial<RoutineTemplate> = {}
  try { payload = JSON.parse(row.payload) as Partial<RoutineTemplate> } catch { /* Keep older damaged templates editable with empty fields. */ }
  return {
    id: row.id, name: row.name, description: row.description, areaId: row.area_id, projectId: row.project_id,
    title: typeof payload.title === 'string' ? payload.title : row.name, notes: typeof payload.notes === 'string' ? payload.notes : '',
    priority: PRIORITIES.has(payload.priority as PlanTaskPriority) ? payload.priority as PlanTaskPriority : 'normal',
    subtasks: Array.isArray(payload.subtasks) ? payload.subtasks.filter((item): item is { title: string; notes: string } => Boolean(item && typeof item.title === 'string' && typeof item.notes === 'string')) : [],
    recurrenceRule: payload.recurrenceRule && typeof payload.recurrenceRule === 'object' ? payload.recurrenceRule : null,
    createdAt: row.created_at, updatedAt: row.updated_at
  }
}

function journalFromRow(row: JournalRow): JournalEntry {
  return { id: row.id, entryDate: row.entry_date, title: row.title, content: row.content, areaId: row.area_id, goalId: row.goal_id, isPinned: row.is_pinned === 1, createdAt: row.created_at, updatedAt: row.updated_at }
}

function requiredText(value: string, max: number, message: string): string {
  if (typeof value !== 'string') throw new Error(message)
  const text = value.trim()
  if (!text || text.length > max) throw new Error(message)
  return text
}

function optionalText(value: unknown, max: number): string {
  if (value === undefined || value === null) return ''
  if (typeof value !== 'string' || value.length > max) throw new Error('Text is longer than allowed.')
  return value.trim()
}

function validateId(value: string): string {
  if (typeof value !== 'string' || value.length < 1 || value.length > 80) throw new Error('Choose a valid item.')
  return value
}

function normalizeDate(value: string | null | undefined): string | null {
  if (value === undefined || value === null || value === '') return null
  return assertDateOnly(value)
}

function normalizeCalendarEvent(event: CalendarEventInput): CalendarEventInput & { externalUid: string | null; title: string; startsAt: string; endsAt: string; allDay: boolean; location: string } {
  const title = requiredText(event.title, 300, 'A calendar event needs a title.')
  const startsAt = normalizeInstant(event.startsAt)
  const endsAt = normalizeInstant(event.endsAt)
  if (Date.parse(endsAt) <= Date.parse(startsAt)) throw new Error('A calendar event must end after it starts.')
  const externalUid = event.externalUid ? optionalText(event.externalUid, 300) : null
  return { externalUid, title, startsAt, endsAt, allDay: event.allDay === true, location: optionalText(event.location, 500) }
}

function normalizeInstant(value: string): string {
  if (typeof value !== 'string' || !/(?:Z|[+-]\d{2}:?\d{2})$/i.test(value) || !Number.isFinite(Date.parse(value))) throw new Error('Calendar events need a valid date and time with a timezone.')
  return new Date(value).toISOString()
}
