import { createHash, randomUUID } from 'node:crypto'
import { appendFile, mkdir, readdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import type { AuditEvent, AuditIntegrity, AuditType } from '../../shared/types'

type NewAuditEvent = {
  type: AuditType
  data?: Record<string, unknown>
  callId?: string
}

type Listener = (event: AuditEvent) => void

const GENESIS_HASH = '0'.repeat(64)

/**
 * Append-only JSONL audit trail with a SHA-256 chain for new records. Legacy
 * records are retained unchanged and the first chained record anchors to the
 * last legacy record. Append errors reject so the gateway fails closed.
 */
export class AuditLog {
  private events: AuditEvent[] = []
  private listeners = new Set<Listener>()
  private queue: Promise<void> = Promise.resolve()
  private integrity: AuditIntegrity = { valid: true, legacyEvents: 0, chainedEvents: 0 }
  private corruptLines = 0

  constructor(
    private readonly dir: string,
    private readonly sessionId: string
  ) {}

  async init(): Promise<void> {
    await mkdir(this.dir, { recursive: true })
    this.corruptLines = 0
    const files = (await readdir(this.dir)).filter((file) => file.endsWith('.jsonl')).sort()
    const loaded: AuditEvent[] = []

    for (const file of files) {
      const text = await readFile(path.join(this.dir, file), 'utf8')
      for (const line of text.split('\n')) {
        if (!line.trim()) continue
        try {
          const event = JSON.parse(line) as AuditEvent
          if (isAuditEvent(event)) loaded.push(event)
          else this.corruptLines += 1
        } catch {
          console.warn(`[audit] skipping corrupt line in ${file}`)
          this.corruptLines += 1
        }
      }
    }

    // The monthly files are append ordered. Stable sorting preserves the
    // original order of records sharing the same millisecond timestamp.
    loaded.sort((a, b) => a.at.localeCompare(b.at))
    this.events = loaded
    this.integrity = verifyChain(loaded)
    if (this.corruptLines > 0) {
      this.integrity = { ...this.integrity, valid: false }
    }
  }

  list(): AuditEvent[] {
    return [...this.events]
  }

  getIntegrity(): AuditIntegrity {
    return { ...this.integrity }
  }

  exportJsonl(): string {
    return this.events.map((event) => JSON.stringify(event)).join('\n') + (this.events.length ? '\n' : '')
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  append(event: NewAuditEvent): Promise<AuditEvent> {
    const write = this.queue.then(async () => {
      if (!this.integrity.valid) {
        throw new Error('Audit integrity verification failed; refusing to append.')
      }

      const base: AuditEvent = {
        id: randomUUID(),
        at: new Date().toISOString(),
        sessionId: this.sessionId,
        callId: event.callId,
        type: event.type,
        data: event.data ?? {}
      }
      const previous = this.events.at(-1)
      const prevHash = previous?.hash ?? (previous ? hashLegacyEvent(previous) : GENESIS_HASH)
      const chained = withHash(base, prevHash)

      await this.persist(chained)
      this.events.push(chained)
      this.integrity = {
        valid: true,
        legacyEvents: this.integrity.legacyEvents,
        chainedEvents: this.integrity.chainedEvents + 1
      }

      for (const listener of this.listeners) {
        try {
          listener(chained)
        } catch (error) {
          console.error('[audit] listener failed', error)
        }
      }

      return chained
    })

    // Keep the queue alive after a failed append, while returning the failure
    // to its caller so permission-gated actions remain fail-closed.
    this.queue = write.then(
      () => undefined,
      () => undefined
    )
    return write
  }

  private async persist(event: AuditEvent): Promise<void> {
    await mkdir(this.dir, { recursive: true })
    const file = path.join(this.dir, `${event.at.slice(0, 7)}.jsonl`)
    await appendFile(file, `${JSON.stringify(event)}\n`, 'utf8')
  }
}

export function verifyChain(events: AuditEvent[]): AuditIntegrity {
  let legacyEvents = 0
  let chainedEvents = 0
  let previousHash = GENESIS_HASH
  let lastLegacy: AuditEvent | undefined
  let chainStarted = false

  for (const event of events) {
    if (!event.hash || !event.prevHash) {
      if (chainStarted) {
        return { valid: false, legacyEvents, chainedEvents, brokenEventId: event.id }
      }
      legacyEvents += 1
      lastLegacy = event
      continue
    }

    const expectedPrevious = chainStarted
      ? previousHash
      : lastLegacy
        ? hashLegacyEvent(lastLegacy)
        : GENESIS_HASH

    if (event.prevHash !== expectedPrevious || event.hash !== hashChainedEvent(event)) {
      return { valid: false, legacyEvents, chainedEvents, brokenEventId: event.id }
    }

    chainStarted = true
    previousHash = event.hash
    chainedEvents += 1
  }

  return { valid: true, legacyEvents, chainedEvents }
}

function withHash(event: AuditEvent, prevHash: string): AuditEvent {
  const base: AuditEvent = { ...event, prevHash }
  return { ...base, hash: hashChainedEvent(base) }
}

function hashChainedEvent(event: AuditEvent): string {
  const { hash: _hash, ...base } = event
  return createHash('sha256').update(`${base.prevHash ?? GENESIS_HASH}\n${stableJson(base)}`).digest('hex')
}

function hashLegacyEvent(event: AuditEvent): string {
  return createHash('sha256').update(stableJson(event)).digest('hex')
}

function stableJson(value: unknown): string {
  return JSON.stringify(sortKeys(value))
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys)
  if (!value || typeof value !== 'object') return value
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => [key, sortKeys(entry)])
  )
}

function isAuditEvent(value: unknown): value is AuditEvent {
  if (!value || typeof value !== 'object') return false
  const event = value as Partial<AuditEvent>
  return (
    typeof event.id === 'string' &&
    typeof event.at === 'string' &&
    typeof event.sessionId === 'string' &&
    typeof event.type === 'string' &&
    Boolean(event.data && typeof event.data === 'object')
  )
}
