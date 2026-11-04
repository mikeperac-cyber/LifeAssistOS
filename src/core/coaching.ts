import { randomUUID } from 'node:crypto'
import { backup, DatabaseSync } from 'node:sqlite'
import { mkdir } from 'node:fs/promises'
import path from 'node:path'
import { assertDateOnly } from '../shared/date-only'
import type {
  CoachArea,
  CoachingContext,
  CoachingGoal,
  CoachingGoalStatus,
  CoachingJournalEntry,
  CoachingJournalKind,
  CoachingMilestone,
  CoachingProfile,
  CoachingStyle,
  ReflectionRetention
} from '../shared/types'

interface ProfileRow { id: number; style: CoachingStyle; reflection_retention: ReflectionRetention; boundaries: string; updated_at: string }
interface GoalRow { id: string; area: CoachArea; title: string; why: string; target_date: string | null; status: CoachingGoalStatus; milestones: string; created_at: string; updated_at: string }
interface JournalRow { id: string; area: CoachArea; kind: CoachingJournalKind; body: string; created_at: string }

const DEFAULT_PROFILE: CoachingProfile = {
  style: 'supportive',
  reflectionRetention: 'ephemeral',
  boundaries: 'Do not diagnose me, guilt me, or make high-stakes decisions for me. Ask before broadening a goal.',
  updatedAt: new Date(0).toISOString()
}

/** Local coaching state. Reflection text only enters this store through an explicit journal save. */
export class CoachingStore {
  private db: DatabaseSync
  private closed = false

  constructor(private readonly file: string) { this.db = new DatabaseSync(file) }

  async init(): Promise<void> {
    if (this.closed) {
      this.db = new DatabaseSync(this.file)
      this.closed = false
    }
    await mkdir(path.dirname(this.dbPath), { recursive: true })
    this.db.exec('PRAGMA journal_mode = WAL; PRAGMA synchronous = FULL;')
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS profile (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        style TEXT NOT NULL CHECK (style IN ('supportive', 'direct', 'socratic')),
        reflection_retention TEXT NOT NULL CHECK (reflection_retention IN ('ephemeral', 'journal')),
        boundaries TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS goals (
        id TEXT PRIMARY KEY,
        area TEXT NOT NULL CHECK (area IN ('personal', 'lb_english')),
        title TEXT NOT NULL,
        why TEXT NOT NULL,
        target_date TEXT,
        status TEXT NOT NULL CHECK (status IN ('active', 'paused', 'completed')),
        milestones TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS journal (
        id TEXT PRIMARY KEY,
        area TEXT NOT NULL CHECK (area IN ('personal', 'lb_english')),
        kind TEXT NOT NULL CHECK (kind IN ('daily', 'weekly')),
        body TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS goals_area_status ON goals(area, status, updated_at);
      CREATE INDEX IF NOT EXISTS journal_created_at ON journal(created_at);
    `)
    if (!this.db.prepare('SELECT id FROM profile WHERE id = 1').get()) {
      this.db.prepare('INSERT INTO profile (id, style, reflection_retention, boundaries, updated_at) VALUES (1, ?, ?, ?, ?)').run(DEFAULT_PROFILE.style, DEFAULT_PROFILE.reflectionRetention, DEFAULT_PROFILE.boundaries, DEFAULT_PROFILE.updatedAt)
    }
  }

  profile(): CoachingProfile {
    const row = this.db.prepare('SELECT * FROM profile WHERE id = 1').get() as ProfileRow | undefined
    if (!row) return DEFAULT_PROFILE
    return { style: row.style, reflectionRetention: row.reflection_retention, boundaries: row.boundaries, updatedAt: row.updated_at }
  }

  updateProfile(patch: Partial<Pick<CoachingProfile, 'style' | 'reflectionRetention' | 'boundaries'>>): CoachingProfile {
    const current = this.profile()
    const style = patch.style ?? current.style
    const reflectionRetention = patch.reflectionRetention ?? current.reflectionRetention
    if (!['supportive', 'direct', 'socratic'].includes(style)) throw new Error('Choose a valid coaching style.')
    if (!['ephemeral', 'journal'].includes(reflectionRetention)) throw new Error('Choose a valid reflection privacy setting.')
    const boundaries = (patch.boundaries ?? current.boundaries).trim().slice(0, 2000)
    const updatedAt = new Date().toISOString()
    this.db.prepare('UPDATE profile SET style = ?, reflection_retention = ?, boundaries = ?, updated_at = ? WHERE id = 1').run(style, reflectionRetention, boundaries, updatedAt)
    return { style, reflectionRetention, boundaries, updatedAt }
  }

  listGoals(area?: CoachArea, includeCompleted = false): CoachingGoal[] {
    const rows = this.db.prepare(`SELECT * FROM goals ${area ? 'WHERE area = ?' : 'WHERE 1 = 1'} ${includeCompleted ? '' : "AND status != 'completed'"} ORDER BY CASE status WHEN 'active' THEN 0 WHEN 'paused' THEN 1 ELSE 2 END, target_date IS NULL, target_date, updated_at DESC`).all(...(area ? [area] : [])) as unknown as GoalRow[]
    return rows.map(goalFromRow)
  }

  getGoal(id: string): CoachingGoal {
    const row = this.db.prepare('SELECT * FROM goals WHERE id = ?').get(id) as GoalRow | undefined
    if (!row) throw new Error('That coaching goal no longer exists.')
    return goalFromRow(row)
  }

  createGoal(input: { area: CoachArea; title: string; why?: string; targetDate?: string | null; milestones?: string[] }): CoachingGoal {
    if (!['personal', 'lb_english'].includes(input.area)) throw new Error('Choose Personal life or LB English.')
    const title = input.title.trim().slice(0, 240)
    if (!title) throw new Error('A goal needs a title.')
    const targetDate = normalizeDate(input.targetDate)
    const now = new Date().toISOString()
    const milestones: CoachingMilestone[] = (input.milestones ?? []).map((title) => ({ id: randomUUID(), title: title.trim().slice(0, 180), done: false })).filter((milestone) => milestone.title).slice(0, 12)
    const goal: CoachingGoal = { id: randomUUID(), area: input.area, title, why: (input.why ?? '').trim().slice(0, 1000), targetDate, status: 'active', milestones, createdAt: now, updatedAt: now }
    this.db.prepare('INSERT INTO goals (id, area, title, why, target_date, status, milestones, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)').run(goal.id, goal.area, goal.title, goal.why, goal.targetDate, goal.status, JSON.stringify(goal.milestones), goal.createdAt, goal.updatedAt)
    return goal
  }

  updateGoal(id: string, patch: { title?: string; why?: string; targetDate?: string | null; status?: CoachingGoalStatus; milestones?: CoachingMilestone[] }): CoachingGoal {
    const current = this.getGoal(id)
    const status = patch.status ?? current.status
    if (!['active', 'paused', 'completed'].includes(status)) throw new Error('Choose a valid goal status.')
    const goal: CoachingGoal = { ...current, title: patch.title === undefined ? current.title : patch.title.trim().slice(0, 240), why: patch.why === undefined ? current.why : patch.why.trim().slice(0, 1000), targetDate: patch.targetDate === undefined ? current.targetDate : normalizeDate(patch.targetDate), status, milestones: patch.milestones ?? current.milestones, updatedAt: new Date().toISOString() }
    if (!goal.title) throw new Error('A goal needs a title.')
    this.db.prepare('UPDATE goals SET title = ?, why = ?, target_date = ?, status = ?, milestones = ?, updated_at = ? WHERE id = ?').run(goal.title, goal.why, goal.targetDate, goal.status, JSON.stringify(goal.milestones), goal.updatedAt, goal.id)
    return goal
  }

  addJournal(input: { area: CoachArea; kind: CoachingJournalKind; body: string }): CoachingJournalEntry {
    if (!['personal', 'lb_english'].includes(input.area) || !['daily', 'weekly'].includes(input.kind)) throw new Error('Choose a valid coaching area and journal type.')
    const body = input.body.trim().slice(0, 12_000)
    if (!body) throw new Error('There is nothing to save yet.')
    const entry: CoachingJournalEntry = { id: randomUUID(), area: input.area, kind: input.kind, body, createdAt: new Date().toISOString() }
    this.db.prepare('INSERT INTO journal (id, area, kind, body, created_at) VALUES (?, ?, ?, ?, ?)').run(entry.id, entry.area, entry.kind, entry.body, entry.createdAt)
    return entry
  }

  listJournal(area?: CoachArea, limit = 30): CoachingJournalEntry[] {
    const rows = this.db.prepare(`SELECT * FROM journal ${area ? 'WHERE area = ?' : ''} ORDER BY created_at DESC LIMIT ?`).all(...(area ? [area, Math.max(1, Math.min(100, limit))] : [Math.max(1, Math.min(100, limit))])) as unknown as JournalRow[]
    return rows.map((row) => ({ id: row.id, area: row.area, kind: row.kind, body: row.body, createdAt: row.created_at }))
  }

  context(area?: CoachArea): CoachingContext {
    const journal = area
      ? this.listJournal(area, 6)
      : [
          ...this.listJournal('personal', 6),
          ...this.listJournal('lb_english', 6)
        ].sort((left, right) => right.createdAt.localeCompare(left.createdAt))
    return {
      profile: this.profile(),
      goals: this.listGoals(area, false),
      journal
    }
  }

  async backupTo(file: string): Promise<void> { await mkdir(path.dirname(file), { recursive: true }); await backup(this.db, file) }
  close(): void { if (!this.closed) { this.db.close(); this.closed = true } }
  private get dbPath(): string { const row = this.db.prepare('PRAGMA database_list').get() as { file?: string } | undefined; return row?.file ? path.dirname(row.file) : process.cwd() }
}

function goalFromRow(row: GoalRow): CoachingGoal {
  let milestones: CoachingMilestone[] = []
  try { const parsed = JSON.parse(row.milestones) as unknown; if (Array.isArray(parsed)) milestones = parsed as CoachingMilestone[] } catch { milestones = [] }
  return { id: row.id, area: row.area, title: row.title, why: row.why, targetDate: row.target_date, status: row.status, milestones, createdAt: row.created_at, updatedAt: row.updated_at }
}

function normalizeDate(value: string | null | undefined): string | null {
  if (!value) return null
  return assertDateOnly(value, 'target date')
}
