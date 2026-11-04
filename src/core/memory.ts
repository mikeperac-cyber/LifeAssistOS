import { randomUUID } from 'node:crypto'
import { mkdir } from 'node:fs/promises'
import path from 'node:path'
import { backup, DatabaseSync } from 'node:sqlite'
import type {
  MemoryFact,
  MemoryFactInput,
  MemoryFactPatch,
  MemoryMatch,
  MemoryScope,
  MemorySource
} from '../shared/types'

const MAX_ACTIVE_FACTS = 500
const MAX_FACT_CHARS = 400

interface FactRow {
  id: string
  text: string
  scope: MemoryScope
  source_kind: string
  source_ref: string
  created_at: string
  updated_at: string
  review_at: string | null
  archived_at: string | null
}

/**
 * User-approved, editable personal facts. The model never writes here on its
 * own authority: saves pass the permission gateway, and every mutation is
 * reachable from the Memory screen. Audit records carry ids and counts only.
 */
export class MemoryStore {
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
      CREATE TABLE IF NOT EXISTS memory_facts (
        id TEXT PRIMARY KEY,
        text TEXT NOT NULL,
        scope TEXT NOT NULL CHECK (scope IN ('personal', 'teaching', 'business', 'general')),
        source_kind TEXT NOT NULL,
        source_ref TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        review_at TEXT,
        archived_at TEXT
      );
      CREATE INDEX IF NOT EXISTS memory_facts_active ON memory_facts(archived_at, updated_at);
    `)
  }

  private get dbPath(): string {
    const row = this.db.prepare('PRAGMA database_list').get() as { file?: string } | undefined
    return row?.file ? path.dirname(row.file) : process.cwd()
  }

  countActive(): number {
    return (this.db.prepare('SELECT COUNT(*) AS n FROM memory_facts WHERE archived_at IS NULL').get() as { n: number }).n
  }

  add(input: MemoryFactInput, now = new Date()): MemoryFact {
    const text = normalizeText(input.text)
    if (text.length < 3) throw new Error('A memory must be at least a few words long.')
    if (text.length > MAX_FACT_CHARS) throw new Error(`A memory can be at most ${MAX_FACT_CHARS} characters.`)
    const scope = normalizeScope(input.scope)
    if (this.countActive() >= MAX_ACTIVE_FACTS) {
      throw new Error('Memory is full. Remove or archive an old fact first.')
    }

    const existing = this.findByText(text)
    if (existing) throw new Error('That exact fact is already saved in memory.')

    const nowIso = now.toISOString()
    const fact: MemoryFact = {
      id: randomUUID(),
      text,
      scope,
      source: normalizeSource(input.source),
      createdAt: nowIso,
      updatedAt: nowIso,
      reviewAt: reviewDate(now, input.reviewInDays),
      archivedAt: null
    }

    this.db.prepare(`
      INSERT INTO memory_facts (id, text, scope, source_kind, source_ref, created_at, updated_at, review_at, archived_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      fact.id,
      fact.text,
      fact.scope,
      fact.source.kind,
      fact.source.ref ?? '',
      fact.createdAt,
      fact.updatedAt,
      fact.reviewAt,
      fact.archivedAt
    )
    return fact
  }

  get(id: string): MemoryFact {
    const row = this.db.prepare('SELECT * FROM memory_facts WHERE id = ?').get(id) as unknown as FactRow | undefined
    if (!row) throw new Error('That memory no longer exists.')
    return fromRow(row)
  }

  findByText(text: string): MemoryFact | null {
    const row = this.db
      .prepare('SELECT * FROM memory_facts WHERE archived_at IS NULL AND text = ? COLLATE NOCASE')
      .get(normalizeText(text)) as unknown as FactRow | undefined
    return row ? fromRow(row) : null
  }

  list(includeArchived = false): MemoryFact[] {
    const rows = this.db
      .prepare(`SELECT * FROM memory_facts ${includeArchived ? '' : 'WHERE archived_at IS NULL'} ORDER BY updated_at DESC`)
      .all() as unknown as FactRow[]
    return rows.map(fromRow)
  }

  update(id: string, patch: MemoryFactPatch, now = new Date()): MemoryFact {
    const fact = this.get(id)
    if (fact.archivedAt) throw new Error('Restore the fact before editing it.')

    let text = fact.text
    let scope = fact.scope
    let reviewAt = fact.reviewAt

    if (patch.text !== undefined) {
      text = normalizeText(patch.text)
      if (text.length < 3 || text.length > MAX_FACT_CHARS) {
        throw new Error(`A memory must be 3–${MAX_FACT_CHARS} characters.`)
      }
      const duplicate = this.findByText(text)
      if (duplicate && duplicate.id !== id) throw new Error('That exact fact is already saved in memory.')
    }
    if (patch.scope !== undefined) scope = normalizeScope(patch.scope)
    if (patch.reviewInDays !== undefined) reviewAt = reviewDate(now, patch.reviewInDays)

    const updatedAt = now.toISOString()
    this.db.prepare(`
      UPDATE memory_facts
      SET text = ?, scope = ?, review_at = ?, updated_at = ?
      WHERE id = ?
    `).run(text, scope, reviewAt, updatedAt, id)
    return this.get(id)
  }

  archive(id: string, now = new Date()): MemoryFact {
    const fact = this.get(id)
    if (fact.archivedAt) return fact
    this.db.prepare('UPDATE memory_facts SET archived_at = ?, updated_at = ? WHERE id = ?')
      .run(now.toISOString(), now.toISOString(), id)
    return this.get(id)
  }

  restore(id: string): MemoryFact {
    const fact = this.get(id)
    if (!fact.archivedAt) return fact
    if (this.countActive() >= MAX_ACTIVE_FACTS) throw new Error('Memory is full.')
    this.db.prepare('UPDATE memory_facts SET archived_at = NULL, updated_at = ? WHERE id = ?')
      .run(new Date().toISOString(), id)
    return this.get(id)
  }

  delete(id: string, now = new Date()): MemoryFact {
    const fact = this.get(id)
    this.db.prepare('DELETE FROM memory_facts WHERE id = ?').run(id)
    void now
    return { ...fact, archivedAt: fact.archivedAt ?? now.toISOString() }
  }

  /** Simple keyword recall over active facts, newest-first within a score. */
  recall(query: string, limit = 6, scopes?: MemoryScope[]): MemoryMatch[] {
    const words = recallWords(query)
    if (words.length === 0 || scopes?.length === 0) return []
    const allowedScopes = scopes ? new Set(scopes) : null
    const rows = this.db
      .prepare('SELECT * FROM memory_facts WHERE archived_at IS NULL ORDER BY updated_at DESC LIMIT 1000')
      .all() as unknown as FactRow[]

    const scored = rows
      .map((row) => {
        const haystack = row.text.toLocaleLowerCase()
        let score = 0
        for (const word of words) {
          if (haystack.includes(word)) score += 1
        }
        return { row, score }
      })
      .filter((entry) => entry.score > 0 && (!allowedScopes || allowedScopes.has(entry.row.scope)))
      .sort((a, b) => b.score - a.score || b.row.updated_at.localeCompare(a.row.updated_at))
      .slice(0, Math.min(10, Math.max(1, limit)))

    return scored.map(({ row }) => ({
      id: row.id,
      text: row.text,
      scope: row.scope,
      updatedAt: row.updated_at
    }))
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
}

export function normalizeText(text: string): string {
  return text.replace(/\s+/g, ' ').trim()
}

export function normalizeScope(scope: unknown): MemoryScope {
  if (scope === 'personal' || scope === 'teaching' || scope === 'business' || scope === 'general') return scope
  throw new Error('Choose a memory scope: personal, teaching, business, or general.')
}

function normalizeSource(source?: MemorySource): MemorySource {
  const kind = source?.kind && /^[a-z]{2,12}$/.test(source.kind) ? source.kind : 'user'
  return { kind, ref: source?.ref ? String(source.ref).slice(0, 120) : undefined }
}

function reviewDate(now: Date, reviewInDays?: number): string | null {
  if (!reviewInDays || !Number.isFinite(reviewInDays) || reviewInDays <= 0) return null
  const days = Math.min(3650, Math.floor(reviewInDays))
  const date = new Date(now)
  date.setDate(date.getDate() + days)
  return date.toISOString()
}

/** Words used for recall matching; very short or numeric tokens are ignored. */
function recallWords(query: string): string[] {
  const words = query
    .toLocaleLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .map((word) => word.trim())
    .filter((word) => word.length >= 3 && /^\p{N}+$/u.test(word) === false)
  return [...new Set(words)].slice(0, 12)
}

function fromRow(row: FactRow): MemoryFact {
  return {
    id: row.id,
    text: row.text,
    scope: row.scope,
    source: { kind: row.source_kind as MemorySource['kind'], ref: row.source_ref || undefined },
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    reviewAt: row.review_at,
    archivedAt: row.archived_at
  }
}
