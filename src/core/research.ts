import { randomUUID } from 'node:crypto'
import { backup, DatabaseSync } from 'node:sqlite'
import { mkdir } from 'node:fs/promises'
import path from 'node:path'
import type { ResearchProject, ResearchProjectStatus, ResearchSource } from '../shared/types'

interface ProjectRow {
  id: string
  title: string
  question: string
  status: ResearchProjectStatus
  created_at: string
  updated_at: string
}

interface SourceRow {
  id: string
  project_id: string
  url: string
  title: string
  content: string
  added_at: string
}

/** Local research projects and source captures. Source text is never written to audit events. */
export class ResearchStore {
  private db: DatabaseSync
  private closed = false

  constructor(private readonly file: string) {
    this.db = new DatabaseSync(file)
  }

  async init(): Promise<void> {
    if (this.closed) {
      this.db = new DatabaseSync(this.file)
      this.closed = false
    }
    await mkdir(path.dirname(this.dbPath), { recursive: true })
    this.db.exec('PRAGMA journal_mode = WAL; PRAGMA synchronous = FULL; PRAGMA foreign_keys = ON;')
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS projects (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        question TEXT NOT NULL,
        status TEXT NOT NULL CHECK (status IN ('active', 'archived')),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS sources (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        url TEXT NOT NULL,
        title TEXT NOT NULL,
        content TEXT NOT NULL,
        added_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS sources_project_id ON sources(project_id);
      CREATE INDEX IF NOT EXISTS projects_updated_at ON projects(updated_at);
    `)
  }

  list(includeArchived = false): ResearchProject[] {
    const rows = this.db.prepare(`SELECT * FROM projects ${includeArchived ? '' : "WHERE status = 'active'"} ORDER BY updated_at DESC`).all() as unknown as ProjectRow[]
    return rows.map((row) => this.fromRow(row))
  }

  get(id: string): ResearchProject {
    const row = this.db.prepare('SELECT * FROM projects WHERE id = ?').get(id) as ProjectRow | undefined
    if (!row) throw new Error('That research project no longer exists.')
    return this.fromRow(row)
  }

  create(input: { title: string; question: string }): ResearchProject {
    const title = input.title.trim().slice(0, 160)
    const question = input.question.trim().slice(0, 1000)
    if (!title || !question) throw new Error('A research project needs a title and a question.')
    const now = new Date().toISOString()
    const project: ProjectRow = { id: randomUUID(), title, question, status: 'active', created_at: now, updated_at: now }
    this.db.prepare('INSERT INTO projects (id, title, question, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)').run(
      project.id, project.title, project.question, project.status, project.created_at, project.updated_at
    )
    return this.fromRow(project)
  }

  archive(id: string): ResearchProject {
    this.get(id)
    const now = new Date().toISOString()
    this.db.prepare("UPDATE projects SET status = 'archived', updated_at = ? WHERE id = ?").run(now, id)
    return this.get(id)
  }

  remove(id: string): void {
    this.get(id)
    this.db.prepare('DELETE FROM projects WHERE id = ?').run(id)
  }

  addSource(input: { projectId: string; url: string; title?: string; content: string }): ResearchSource {
    this.get(input.projectId)
    const url = input.url.trim().slice(0, 2000)
    const content = input.content.trim().slice(0, 100_000)
    if (!url || !content) throw new Error('A source needs a URL and readable text.')
    const source: ResearchSource = {
      id: randomUUID(),
      projectId: input.projectId,
      url,
      title: (input.title?.trim() || new URL(url).hostname).slice(0, 240),
      content,
      contentChars: content.length,
      addedAt: new Date().toISOString()
    }
    this.db.prepare('INSERT INTO sources (id, project_id, url, title, content, added_at) VALUES (?, ?, ?, ?, ?, ?)').run(
      source.id, source.projectId, source.url, source.title, source.content, source.addedAt
    )
    this.db.prepare('UPDATE projects SET updated_at = ? WHERE id = ?').run(source.addedAt, source.projectId)
    return source
  }

  removeSource(id: string): void {
    this.db.prepare('DELETE FROM sources WHERE id = ?').run(id)
  }

  async backupTo(file: string): Promise<void> {
    await mkdir(path.dirname(file), { recursive: true })
    await backup(this.db, file)
  }

  close(): void {
    if (!this.closed) {
      this.db.close()
      this.closed = true
    }
  }

  private fromRow(row: ProjectRow): ResearchProject {
    const sources = this.db.prepare('SELECT * FROM sources WHERE project_id = ? ORDER BY added_at DESC').all(row.id) as unknown as SourceRow[]
    return {
      id: row.id,
      title: row.title,
      question: row.question,
      status: row.status,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      sources: sources.map((source) => ({
        id: source.id,
        projectId: source.project_id,
        url: source.url,
        title: source.title,
        content: source.content,
        contentChars: source.content.length,
        addedAt: source.added_at
      }))
    }
  }

  private get dbPath(): string {
    const row = this.db.prepare('PRAGMA database_list').get() as { file?: string } | undefined
    return row?.file ? path.dirname(row.file) : process.cwd()
  }
}
