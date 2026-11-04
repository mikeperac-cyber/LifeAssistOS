import { createHash, randomUUID } from 'node:crypto'
import { backup, DatabaseSync } from 'node:sqlite'
import { openSQLiteDatabase } from './sqlite'
import { mkdir } from 'node:fs/promises'
import path from 'node:path'

export const MAX_CHECKPOINT_FILE_BYTES = 5 * 1024 * 1024
const MAX_CHECKPOINTS_PER_FILE = 10
const MAX_CHECKPOINTS_TOTAL = 100
const MAX_CHECKPOINT_BYTES_TOTAL = 100 * 1024 * 1024

export interface FileCheckpoint {
  id: string
  grantId: string
  relativePath: string
  beforeExists: boolean
  beforeBytes: number
  beforeSha256: string | null
  afterExists: boolean
  afterSha256: string | null
  createdAt: string
}

export interface FileCheckpointWithContent extends FileCheckpoint {
  beforeContent: Uint8Array | null
}

interface CheckpointRow {
  id: string
  grant_id: string
  relative_path: string
  before_exists: number
  before_content: Uint8Array | null
  before_sha256: string | null
  after_exists: number
  after_sha256: string | null
  created_at: string
}

/** Bounded local snapshots used to restore assistant-written files. */
export class FileCheckpointStore {
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
    await mkdir(path.dirname(this.file), { recursive: true })
    this.db.exec('PRAGMA journal_mode = WAL; PRAGMA synchronous = FULL;')
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS file_checkpoints (
        id TEXT PRIMARY KEY,
        grant_id TEXT NOT NULL,
        relative_path TEXT NOT NULL,
        before_exists INTEGER NOT NULL CHECK (before_exists IN (0, 1)),
        before_content BLOB,
        before_sha256 TEXT,
        after_exists INTEGER NOT NULL CHECK (after_exists IN (0, 1)),
        after_sha256 TEXT,
        created_at TEXT NOT NULL,
        CHECK ((before_exists = 0 AND before_content IS NULL AND before_sha256 IS NULL) OR
               (before_exists = 1 AND before_content IS NOT NULL AND before_sha256 IS NOT NULL)),
        CHECK ((after_exists = 0 AND after_sha256 IS NULL) OR
               (after_exists = 1 AND after_sha256 IS NOT NULL))
      );
      CREATE INDEX IF NOT EXISTS file_checkpoints_by_path
        ON file_checkpoints(grant_id, relative_path, created_at DESC);
    `)
  }

  create(input: {
    grantId: string
    relativePath: string
    beforeContent: Uint8Array | null
    afterContent: Uint8Array | null
  }): FileCheckpoint {
    if (input.beforeContent && input.beforeContent.byteLength > MAX_CHECKPOINT_FILE_BYTES) {
      throw new Error(`The existing file is larger than the ${MAX_CHECKPOINT_FILE_BYTES / 1024 / 1024} MB restore-point limit. No change was made.`)
    }
    if (input.afterContent && input.afterContent.byteLength > MAX_CHECKPOINT_FILE_BYTES) {
      throw new Error(`The restored file would exceed the ${MAX_CHECKPOINT_FILE_BYTES / 1024 / 1024} MB restore-point limit. No change was made.`)
    }

    const checkpoint: FileCheckpoint = {
      id: randomUUID(),
      grantId: input.grantId,
      relativePath: input.relativePath,
      beforeExists: input.beforeContent !== null,
      beforeBytes: input.beforeContent?.byteLength ?? 0,
      beforeSha256: sha256(input.beforeContent),
      afterExists: input.afterContent !== null,
      afterSha256: sha256(input.afterContent),
      createdAt: new Date().toISOString()
    }

    this.db.exec('BEGIN IMMEDIATE')
    try {
      this.db.prepare(`
        INSERT INTO file_checkpoints (
          id, grant_id, relative_path, before_exists, before_content,
          before_sha256, after_exists, after_sha256, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        checkpoint.id,
        checkpoint.grantId,
        checkpoint.relativePath,
        checkpoint.beforeExists ? 1 : 0,
        input.beforeContent === null ? null : Buffer.from(input.beforeContent),
        checkpoint.beforeSha256,
        checkpoint.afterExists ? 1 : 0,
        checkpoint.afterSha256,
        checkpoint.createdAt
      )
      this.prune(checkpoint.grantId, checkpoint.relativePath)
      this.db.exec('COMMIT')
    } catch (error) {
      try { this.db.exec('ROLLBACK') } catch { /* Keep the original checkpoint failure. */ }
      throw error
    }
    return checkpoint
  }

  list(grantId: string, relativePath: string, limit = MAX_CHECKPOINTS_PER_FILE): FileCheckpoint[] {
    const safeLimit = Math.max(1, Math.min(MAX_CHECKPOINTS_PER_FILE, Math.floor(limit)))
    const rows = this.db.prepare(`
      SELECT id, grant_id, relative_path, before_exists, length(before_content) AS before_bytes,
        before_sha256, after_exists, after_sha256, created_at
      FROM file_checkpoints
      WHERE grant_id = ? AND relative_path = ?
      ORDER BY created_at DESC, rowid DESC
      LIMIT ?
    `).all(grantId, relativePath, safeLimit) as unknown as Array<CheckpointRow & { before_bytes: number | null }>
    return rows.map((row) => checkpointFromRow(row))
  }

  get(id: string, grantId: string, relativePath: string): FileCheckpointWithContent {
    const row = this.db.prepare(`
      SELECT id, grant_id, relative_path, before_exists, before_content, before_sha256,
        after_exists, after_sha256, created_at
      FROM file_checkpoints
      WHERE id = ? AND grant_id = ? AND relative_path = ?
    `).get(id, grantId, relativePath) as CheckpointRow | undefined
    if (!row) throw new Error('That restore point is unavailable for this approved folder and file.')
    const checkpoint = checkpointFromRow(row)
    if (checkpoint.beforeExists && !row.before_content) {
      throw new Error('That restore point is incomplete and cannot be used.')
    }
    return { ...checkpoint, beforeContent: row.before_content ? new Uint8Array(row.before_content) : null }
  }

  remove(id: string): void {
    this.db.prepare('DELETE FROM file_checkpoints WHERE id = ?').run(id)
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

  private prune(grantId: string, relativePath: string): void {
    this.db.prepare(`
      DELETE FROM file_checkpoints
      WHERE rowid IN (
        SELECT rowid FROM file_checkpoints
        WHERE grant_id = ? AND relative_path = ?
        ORDER BY created_at DESC, rowid DESC
        LIMIT -1 OFFSET ?
      )
    `).run(grantId, relativePath, MAX_CHECKPOINTS_PER_FILE)

    for (;;) {
      const totals = this.db.prepare(`
        SELECT COUNT(*) AS count, COALESCE(SUM(length(before_content)), 0) AS bytes
        FROM file_checkpoints
      `).get() as { count: number; bytes: number }
      if (totals.count <= MAX_CHECKPOINTS_TOTAL && totals.bytes <= MAX_CHECKPOINT_BYTES_TOTAL) break
      const oldest = this.db.prepare('SELECT id FROM file_checkpoints ORDER BY created_at, rowid LIMIT 1').get() as { id: string } | undefined
      if (!oldest) break
      this.db.prepare('DELETE FROM file_checkpoints WHERE id = ?').run(oldest.id)
    }
  }
}

function checkpointFromRow(row: CheckpointRow | (CheckpointRow & { before_bytes: number | null })): FileCheckpoint {
  return {
    id: row.id,
    grantId: row.grant_id,
    relativePath: row.relative_path,
    beforeExists: row.before_exists === 1,
    beforeBytes: 'before_bytes' in row ? row.before_bytes ?? 0 : row.before_content?.byteLength ?? 0,
    beforeSha256: row.before_sha256,
    afterExists: row.after_exists === 1,
    afterSha256: row.after_sha256,
    createdAt: row.created_at
  }
}

export function checkpointHash(content: Uint8Array | null): string | null {
  return sha256(content)
}

function sha256(content: Uint8Array | null): string | null {
  return content === null ? null : createHash('sha256').update(content).digest('hex')
}
