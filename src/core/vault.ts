import { randomUUID } from 'node:crypto'
import { backup, DatabaseSync } from 'node:sqlite'
import { openSQLiteDatabase } from './sqlite'
import { mkdir } from 'node:fs/promises'
import path from 'node:path'
import type { VaultDocument, VaultQuickSearchResult, VaultSearchResult, VaultSourceType } from '../shared/types'

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

interface QuickSearchRow {
  id: string
  title: string
  tags: string
  source_type: VaultSourceType
  updated_at: string
  snippet: string
}

/** FTS5-backed local knowledge vault. The index contains no remote service metadata. */
export class VaultStore {
  private db: DatabaseSync
  private closed = false

  constructor(private readonly file: string) {
    this.db = openSQLiteDatabase(file)
  }

  async init(): Promise<void> {
    if (this.closed) {
      this.db = openSQLiteDatabase(this.file)
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
      CREATE TABLE IF NOT EXISTS vault_meta (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
      CREATE TRIGGER IF NOT EXISTS documents_fts_insert AFTER INSERT ON documents BEGIN
        INSERT INTO documents_fts (id, title, body, tags) VALUES (new.id, new.title, new.body, new.tags);
      END;
      CREATE TRIGGER IF NOT EXISTS documents_fts_delete AFTER DELETE ON documents BEGIN
        DELETE FROM documents_fts WHERE id = old.id;
      END;
      CREATE TRIGGER IF NOT EXISTS documents_fts_update AFTER UPDATE OF title, body, tags ON documents BEGIN
        DELETE FROM documents_fts WHERE id = old.id;
        INSERT INTO documents_fts (id, title, body, tags) VALUES (new.id, new.title, new.body, new.tags);
      END;
    `)
    const ftsVersion = this.db.prepare("SELECT value FROM vault_meta WHERE key = 'documents_fts_version'").get() as { value?: string } | undefined
    if (ftsVersion?.value !== '1') {
      this.db.exec('BEGIN IMMEDIATE')
      try {
        this.db.exec('DELETE FROM documents_fts')
        const documents = this.db.prepare('SELECT id, title, body, tags FROM documents').all() as Array<{ id: string; title: string; body: string; tags: string }>
        const insert = this.db.prepare('INSERT INTO documents_fts (id, title, body, tags) VALUES (?, ?, ?, ?)')
        for (const document of documents) insert.run(document.id, document.title, document.body, storedTags(document.tags))
        this.db.prepare(`
          INSERT INTO vault_meta (key, value) VALUES ('documents_fts_version', '1')
          ON CONFLICT(key) DO UPDATE SET value = excluded.value
        `).run()
        this.db.exec('COMMIT')
      } catch (error) {
        try { this.db.exec('ROLLBACK') } catch { /* Keep the original failure. */ }
        throw error
      }
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

  searchSummaries(query: string, limit = 8): VaultQuickSearchResult[] {
    const clean = query.trim()
    const safeLimit = Math.max(1, Math.min(20, Math.floor(limit)))
    if (!clean) {
      const rows = this.db.prepare(`
        SELECT id, title, tags, source_type, updated_at, substr(body, 1, 220) AS snippet
        FROM documents ORDER BY updated_at DESC LIMIT ?
      `).all(safeLimit) as unknown as QuickSearchRow[]
      return rows.map(fromQuickSearchRow)
    }
    const match = clean.split(/\s+/).map((token) => token.replace(/[^\p{L}\p{N}_-]/gu, '')).filter(Boolean).map((token) => `"${token.replace(/"/g, '""')}"*`).join(' AND ')
    if (!match) return []
    const rows = this.db.prepare(`
      SELECT d.id, d.title, d.tags, d.source_type, d.updated_at,
        snippet(documents_fts, 2, '', '', '…', 32) AS snippet
      FROM documents_fts f
      JOIN documents d ON d.id = f.id
      WHERE documents_fts MATCH ?
      ORDER BY rank
      LIMIT ?
    `).all(match, safeLimit) as unknown as QuickSearchRow[]
    return rows.map(fromQuickSearchRow)
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
    this.transaction(() => {
      this.db.prepare('UPDATE documents SET title = ?, body = ?, tags = ?, updated_at = ? WHERE id = ?').run(
        document.title, document.body, JSON.stringify(document.tags), document.updatedAt, document.id
      )
    })
    return document
  }

  delete(id: string): void {
    this.get(id)
    this.transaction(() => {
      this.db.prepare('DELETE FROM documents WHERE id = ?').run(id)
    })
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
    this.transaction(() => {
      this.db.prepare('INSERT INTO documents (id, title, body, tags, source_type, source_ref, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(
        document.id, document.title, document.body, JSON.stringify(document.tags), document.sourceType, document.sourceRef ?? null, document.createdAt, document.updatedAt
      )
    })
  }

  private transaction<T>(operation: () => T): T {
    this.db.exec('BEGIN IMMEDIATE')
    try {
      const result = operation()
      this.db.exec('COMMIT')
      return result
    } catch (error) {
      try { this.db.exec('ROLLBACK') } catch { /* Keep the original failure. */ }
      throw error
    }
  }

  private get dbPath(): string {
    const row = this.db.prepare('PRAGMA database_list').get() as { file?: string } | undefined
    return row?.file ? path.dirname(row.file) : process.cwd()
  }
}

function storedTags(value: string): string {
  try {
    const parsed = JSON.parse(value) as unknown
    if (Array.isArray(parsed)) return parsed.filter((tag): tag is string => typeof tag === 'string').join(' ')
  } catch { /* Preserve searchability of older plain-text tags. */ }
  return value
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

function fromQuickSearchRow(row: QuickSearchRow): VaultQuickSearchResult {
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
    tags,
    sourceType: row.source_type,
    updatedAt: row.updated_at,
    snippet: row.snippet
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
