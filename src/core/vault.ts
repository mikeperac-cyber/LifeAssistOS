import { randomUUID } from 'node:crypto'
import { backup, DatabaseSync } from 'node:sqlite'
import { mkdir } from 'node:fs/promises'
import path from 'node:path'
import type { VaultDocument, VaultSearchResult, VaultSourceType } from '../shared/types'

interface DocumentRow {
  id: string
  title: string
  body: string
  tags: string
  source_type: VaultSourceType
  source_ref: string | null
  created_at: string
  updated_at: string
}

/** FTS5-backed local knowledge vault. The index contains no remote service metadata. */
export class VaultStore {
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
    this.db.exec('PRAGMA journal_mode = WAL; PRAGMA synchronous = FULL;')
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS documents (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        body TEXT NOT NULL,
        tags TEXT NOT NULL,
        source_type TEXT NOT NULL,
        source_ref TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE VIRTUAL TABLE IF NOT EXISTS documents_fts USING fts5(
        id UNINDEXED, title, body, tags
      );
      CREATE INDEX IF NOT EXISTS documents_updated_at ON documents(updated_at);
    `)
    const count = this.db.prepare('SELECT COUNT(*) AS count FROM documents_fts').get() as { count: number }
    const documents = this.db.prepare('SELECT id, title, body, tags FROM documents').all() as Array<{ id: string; title: string; body: string; tags: string }>
    if (count.count === 0 && documents.length > 0) {
      const insert = this.db.prepare('INSERT INTO documents_fts (id, title, body, tags) VALUES (?, ?, ?, ?)')
      for (const document of documents) insert.run(document.id, document.title, document.body, document.tags)
    }
  }

  list(limit = 100): VaultDocument[] {
    const rows = this.db.prepare('SELECT * FROM documents ORDER BY updated_at DESC LIMIT ?').all(Math.max(1, Math.min(500, limit))) as unknown as DocumentRow[]
    return rows.map(fromRow)
  }

  get(id: string): VaultDocument {
    const row = this.db.prepare('SELECT * FROM documents WHERE id = ?').get(id) as DocumentRow | undefined
    if (!row) throw new Error('That vault document no longer exists.')
    return fromRow(row)
  }

  search(query: string, limit = 30): VaultSearchResult[] {
    const clean = query.trim()
    if (!clean) return this.list(limit).map((document) => ({ document, snippet: document.body.slice(0, 220) }))
    const match = clean.split(/\s+/).map((token) => token.replace(/[^\p{L}\p{N}_-]/gu, '')).filter(Boolean).map((token) => `"${token.replace(/"/g, '""')}"*`).join(' AND ')
    if (!match) return []
    const rows = this.db.prepare(`
      SELECT d.* FROM documents_fts f
      JOIN documents d ON d.id = f.id
      WHERE documents_fts MATCH ?
      ORDER BY rank
      LIMIT ?
    `).all(match, Math.max(1, Math.min(100, limit))) as unknown as DocumentRow[]
    return rows.map((row) => ({ document: fromRow(row), snippet: snippetFor(row.body, clean) }))
  }

  create(input: { title: string; body: string; tags?: string[]; sourceType?: VaultSourceType; sourceRef?: string }): VaultDocument {
    const title = input.title.trim().slice(0, 240)
    const body = input.body.trim().slice(0, 200_000)
    if (!title || !body) throw new Error('A vault document needs a title and some content.')
    const now = new Date().toISOString()
    const document: VaultDocument = {
      id: randomUUID(),
      title,
      body,
      tags: normalizeTags(input.tags ?? []),
      sourceType: input.sourceType ?? 'manual',
      sourceRef: input.sourceRef?.trim().slice(0, 2000) || undefined,
      createdAt: now,
      updatedAt: now
    }
    this.insert(document)
    return document
  }

  update(id: string, patch: { title?: string; body?: string; tags?: string[] }): VaultDocument {
    const current = this.get(id)
    const document: VaultDocument = {
      ...current,
      title: patch.title === undefined ? current.title : patch.title.trim().slice(0, 240),
      body: patch.body === undefined ? current.body : patch.body.trim().slice(0, 200_000),
      tags: patch.tags === undefined ? current.tags : normalizeTags(patch.tags),
      updatedAt: new Date().toISOString()
    }
    if (!document.title || !document.body) throw new Error('A vault document needs a title and some content.')
    this.db.prepare('UPDATE documents SET title = ?, body = ?, tags = ?, updated_at = ? WHERE id = ?').run(
      document.title, document.body, JSON.stringify(document.tags), document.updatedAt, document.id
    )
    this.reindex(document)
    return document
  }

  delete(id: string): void {
    this.get(id)
    this.db.prepare('DELETE FROM documents WHERE id = ?').run(id)
    this.db.prepare('DELETE FROM documents_fts WHERE id = ?').run(id)
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

  private insert(document: VaultDocument): void {
    this.db.prepare('INSERT INTO documents (id, title, body, tags, source_type, source_ref, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(
      document.id, document.title, document.body, JSON.stringify(document.tags), document.sourceType, document.sourceRef ?? null, document.createdAt, document.updatedAt
    )
    this.reindex(document)
  }

  private reindex(document: VaultDocument): void {
    this.db.prepare('DELETE FROM documents_fts WHERE id = ?').run(document.id)
    this.db.prepare('INSERT INTO documents_fts (id, title, body, tags) VALUES (?, ?, ?, ?)').run(
      document.id, document.title, document.body, document.tags.join(' ')
    )
  }

  private get dbPath(): string {
    const row = this.db.prepare('PRAGMA database_list').get() as { file?: string } | undefined
    return row?.file ? path.dirname(row.file) : process.cwd()
  }
}

function fromRow(row: DocumentRow): VaultDocument {
  let tags: string[] = []
  try {
    const parsed = JSON.parse(row.tags) as unknown
    if (Array.isArray(parsed)) tags = parsed.filter((tag): tag is string => typeof tag === 'string')
  } catch {
    tags = row.tags.split(/\s+/).filter(Boolean)
  }
  return {
    id: row.id,
    title: row.title,
    body: row.body,
    tags,
    sourceType: row.source_type,
    sourceRef: row.source_ref ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  }
}

function normalizeTags(tags: string[]): string[] {
  return [...new Set(tags.map((tag) => tag.trim().toLowerCase().replace(/[^\p{L}\p{N}_-]+/gu, '-')).filter(Boolean))].slice(0, 20)
}

function snippetFor(body: string, query: string): string {
  const needle = query.split(/\s+/).find(Boolean)?.toLowerCase() ?? ''
  const index = body.toLowerCase().indexOf(needle)
  if (index < 0) return body.slice(0, 240)
  return `${index > 80 ? '…' : ''}${body.slice(Math.max(0, index - 80), index + 180)}${index + 180 < body.length ? '…' : ''}`
}
