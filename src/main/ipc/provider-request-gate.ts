import { randomUUID } from 'node:crypto'
import { mkdir } from 'node:fs/promises'
import { DatabaseSync } from 'node:sqlite'
import path from 'node:path'

export class ProviderRequestGateError extends Error {
  constructor(readonly reason: 'busy' | 'rate_limit' | 'storage') {
    super(reason === 'busy'
      ? 'Too many AI requests are already running. Try again shortly.'
      : reason === 'rate_limit'
        ? 'You have reached the short AI request limit. Wait a moment and try again.'
        : 'AI requests are temporarily unavailable because local usage limits could not be checked.')
    this.name = 'ProviderRequestGateError'
  }
}

// A provider can take up to three 180-second attempts. Keep its reservation
// through that period, then reclaim it if the app crashed before release.
const MAX_ACTIVE_REQUEST_AGE_MS = 10 * 60_000

/** A durable, cross-process request budget shared by app builds using the same user data. */
export class ProviderRequestGate {
  private db: DatabaseSync | null = null
  private initialized = false
  private queue: Promise<void> = Promise.resolve()

  constructor(
    private readonly maxRequests = 20,
    private readonly maxConcurrent = 3,
    private readonly windowMs = 60_000,
    private readonly now: () => number = Date.now,
    private readonly stateFile?: string
  ) {
    if (!stateFile) {
      this.db = new DatabaseSync(':memory:')
      this.configureDatabase(this.db)
      this.initialized = true
    }
  }

  async init(): Promise<void> {
    if (this.initialized) return
    if (!this.stateFile) throw new Error('Missing provider request limit database path')
    await mkdir(path.dirname(this.stateFile), { recursive: true })
    const db = new DatabaseSync(this.stateFile)
    try {
      this.configureDatabase(db)
      db.exec('PRAGMA journal_mode = WAL; PRAGMA synchronous = FULL;')
      db.exec(`CREATE TABLE IF NOT EXISTS provider_requests (
        id TEXT PRIMARY KEY,
        requested_at INTEGER NOT NULL,
        completed_at INTEGER
      ); CREATE INDEX IF NOT EXISTS provider_requests_recent ON provider_requests(requested_at);`)
      this.db = db
      this.initialized = true
    } catch (error) {
      db.close()
      throw error
    }
  }

  async run<T>(operation: () => Promise<T>): Promise<T> {
    const id = randomUUID()
    await this.serialize(() => this.reserve(id))
    try {
      return await operation()
    } finally {
      await this.serialize(() => this.release(id))
    }
  }

  private configureDatabase(db: DatabaseSync): void {
    db.exec('PRAGMA busy_timeout = 5000;')
    db.exec(`CREATE TABLE IF NOT EXISTS provider_requests (
      id TEXT PRIMARY KEY,
      requested_at INTEGER NOT NULL,
      completed_at INTEGER
    ); CREATE INDEX IF NOT EXISTS provider_requests_recent ON provider_requests(requested_at);`)
  }

  private async serialize(operation: () => void): Promise<void> {
    const previous = this.queue
    let release!: () => void
    this.queue = new Promise<void>((resolve) => { release = resolve })
    await previous
    try { operation() } finally { release() }
  }

  close(): void {
    this.db?.close()
    this.db = null
    this.initialized = false
  }

  private reserve(id: string): void {
    const db = this.getDatabase()
    const now = this.now()
    const cutoff = now - this.windowMs
    try {
      db.exec('BEGIN IMMEDIATE')
      db.prepare(`DELETE FROM provider_requests
        WHERE (completed_at IS NOT NULL AND requested_at <= ?)
          OR (completed_at IS NULL AND requested_at <= ?)`)
        .run(cutoff, now - MAX_ACTIVE_REQUEST_AGE_MS)
      const count = db.prepare('SELECT COUNT(*) AS count FROM provider_requests WHERE requested_at > ?').get(cutoff) as { count: number }
      if (count.count >= this.maxRequests) throw new ProviderRequestGateError('rate_limit')
      const active = db.prepare('SELECT COUNT(*) AS count FROM provider_requests WHERE completed_at IS NULL').get() as { count: number }
      if (active.count >= this.maxConcurrent) throw new ProviderRequestGateError('busy')
      db.prepare('INSERT INTO provider_requests (id, requested_at, completed_at) VALUES (?, ?, NULL)').run(id, now)
      db.exec('COMMIT')
    } catch (error) {
      this.rollback(db)
      if (error instanceof ProviderRequestGateError) throw error
      throw new ProviderRequestGateError('storage')
    }
  }

  private release(id: string): void {
    const db = this.getDatabase()
    try {
      db.exec('BEGIN IMMEDIATE')
      db.prepare('UPDATE provider_requests SET completed_at = ? WHERE id = ?').run(this.now(), id)
      db.exec('COMMIT')
    } catch {
      this.rollback(db)
      // A stale active row expires with the rolling window; this fails closed until then.
    }
  }

  private rollback(db: DatabaseSync): void {
    try { db.exec('ROLLBACK') } catch { /* no transaction to roll back */ }
  }

  private getDatabase(): DatabaseSync {
    if (!this.initialized || !this.db) throw new ProviderRequestGateError('storage')
    return this.db
  }
}
