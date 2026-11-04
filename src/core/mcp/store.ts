import { randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import type { McpServerRecord, McpServerInput } from '../../shared/types'

interface McpServersFile {
  version: 1
  servers: McpServerRecord[]
}

const NAME_PATTERN = /^[a-zA-Z0-9_-]{1,24}$/

/**
 * User-configured MCP connector definitions. Mike Assist never installs or
 * downloads servers; it only connects to what is written here by the user.
 */
export class McpServerStore {
  private servers: McpServerRecord[] = []
  private mutationQueue: Promise<void> = Promise.resolve()

  constructor(private readonly file: string) {}

  async init(): Promise<void> {
    await this.mutate(async () => {
      await mkdir(path.dirname(this.file), { recursive: true })
      let next: McpServerRecord[] = []
      try {
        const parsed = JSON.parse(await readFile(this.file, 'utf8')) as McpServersFile
        next = Array.isArray(parsed.servers)
          ? parsed.servers.filter((entry) => validStoredRecord(entry))
          : []
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
          console.warn('[mcp] could not read the servers file; starting empty', error)
        }
      }
      await this.persist(next)
      this.servers = next
    })
  }

  list(): McpServerRecord[] {
    return this.servers.map((entry) => ({
      ...entry,
      args: Array.isArray(entry.args) ? [...entry.args] : []
    }))
  }

  get(id: string): McpServerRecord {
    const found = this.servers.find((entry) => entry.id === id)
    if (!found) throw new Error('That MCP connection no longer exists.')
    return { ...found, args: Array.isArray(found.args) ? [...found.args] : [] }
  }

  getByName(name: string): McpServerRecord | undefined {
    const found = this.servers.find((entry) => entry.name === name)
    return found ? { ...found, args: Array.isArray(found.args) ? [...found.args] : [] } : undefined
  }

  /** Validates a raw record coming from the renderer before it is stored. */
  normalizeInput(input: unknown): McpServerInput | null {
    if (!input || typeof input !== 'object') return null
    const record = input as {
      name?: unknown
      transport?: unknown
      command?: unknown
      args?: unknown
      url?: unknown
      enabled?: unknown
    }
    const name = typeof record.name === 'string' ? record.name.trim() : ''
    if (!NAME_PATTERN.test(name)) return null
    if (this.getByName(name)) return null

    if (record.transport === 'stdio') {
      const command = typeof record.command === 'string' ? record.command.trim() : ''
      if (!command) return null
      const args = Array.isArray(record.args)
        ? record.args.filter((entry): entry is string => typeof entry === 'string').slice(0, 32)
        : []
      return { name, transport: 'stdio', command, args, enabled: record.enabled !== false }
    }

    if (record.transport !== 'http') return null
    const url = typeof record.url === 'string' ? record.url.trim() : ''
    if (!isAcceptableUrl(url)) return null
    return { name, transport: 'http', url, enabled: record.enabled !== false }
  }

  async add(input: McpServerInput): Promise<McpServerRecord> {
    return this.mutate(async () => {
      if (!NAME_PATTERN.test(input.name.trim()) || this.getByName(input.name)) {
        throw new Error('Choose a unique name of 1-24 letters, digits, dashes, or underscores.')
      }
      const record: McpServerRecord = {
        id: randomUUID(),
        name: input.name.trim(),
        transport: input.transport,
        command: input.command,
        args: input.args ?? [],
        url: input.url,
        enabled: input.enabled !== false,
        createdAt: new Date().toISOString()
      }
      const next = [...this.servers, record]
      await this.persist(next)
      this.servers = next
      return { ...record, args: [...(record.args ?? [])] }
    })
  }

  async update(id: string, patch: Partial<McpServerInput>): Promise<McpServerRecord> {
    return this.mutate(async () => {
      const index = this.servers.findIndex((entry) => entry.id === id)
      if (index < 0) throw new Error('That MCP connection no longer exists.')
      const record: McpServerRecord = {
        ...this.servers[index],
        args: [...(this.servers[index].args ?? [])]
      }
      if (patch.name !== undefined) {
        const name = patch.name.trim()
        if (!NAME_PATTERN.test(name) || (name !== record.name && this.getByName(name))) {
          throw new Error('Choose a unique name of 1-24 letters, digits, dashes, or underscores.')
        }
        record.name = name
      }
      if (patch.command !== undefined) record.command = typeof patch.command === 'string' ? patch.command.trim() : undefined
      if (patch.args !== undefined) {
        record.args = Array.isArray(patch.args)
          ? patch.args.filter((entry): entry is string => typeof entry === 'string').slice(0, 32)
          : []
      }
      if (patch.url !== undefined) {
        const url = typeof patch.url === 'string' ? patch.url.trim() : ''
        record.url = url || undefined
      }
      if (patch.transport !== undefined && (patch.transport === 'stdio' || patch.transport === 'http')) {
        record.transport = patch.transport
      }
      if (patch.enabled !== undefined) record.enabled = patch.enabled !== false

      if (record.transport === 'stdio' && !record.command) {
        throw new Error('Stdio connections need a command to launch.')
      }
      if (record.transport === 'http') {
        if (!record.url || !isAcceptableUrl(record.url)) {
          throw new Error('HTTP connections need an https URL (or loopback http).')
        }
        record.command = undefined
        record.args = []
      }
      if (record.transport === 'stdio') record.url = undefined

      const next = [...this.servers]
      next[index] = record
      await this.persist(next)
      this.servers = next
      return { ...record, args: [...(record.args ?? [])] }
    })
  }

  async remove(id: string): Promise<void> {
    await this.mutate(async () => {
      const next = this.servers.filter((entry) => entry.id !== id)
      if (next.length === this.servers.length) throw new Error('That MCP connection no longer exists.')
      await this.persist(next)
      this.servers = next
    })
  }

  private mutate<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.mutationQueue.then(operation, operation)
    this.mutationQueue = result.then(() => undefined, () => undefined)
    return result
  }

  private async persist(servers: McpServerRecord[]): Promise<void> {
    const payload: McpServersFile = { version: 1, servers }
    const temporary = `${this.file}.${randomUUID()}.tmp`
    try {
      await writeFile(temporary, `${JSON.stringify(payload, null, 2)}\n`, 'utf8')
      await rename(temporary, this.file)
    } catch (error) {
      await rm(temporary, { force: true }).catch(() => undefined)
      throw error
    }
  }
}

function validStoredRecord(record: unknown): boolean {
  if (!record || typeof record !== 'object') return false
  const entry = record as {
    id?: unknown
    name?: unknown
    transport?: unknown
    command?: unknown
    args?: unknown
    url?: unknown
    enabled?: unknown
    createdAt?: unknown
  }
  if (typeof entry.id !== 'string' || typeof entry.createdAt !== 'string' || typeof entry.name !== 'string') {
    return false
  }
  if (!NAME_PATTERN.test(entry.name) || entry.enabled !== undefined && typeof entry.enabled !== 'boolean') {
    return false
  }
  if (
    entry.args !== undefined &&
    (!Array.isArray(entry.args) || entry.args.length > 32 || entry.args.some((arg) => typeof arg !== 'string'))
  ) return false
  if (entry.transport === 'stdio') return typeof entry.command === 'string' && entry.command.trim().length > 0
  if (entry.transport === 'http') {
    return typeof entry.url === 'string' && isAcceptableUrl(entry.url)
  }
  return false
}

/**
 * HTTPS anywhere; plain HTTP only for loopback hosts, because local MCP
 * servers frequently listen on http without TLS.
 */
export function isAcceptableUrl(input: string): boolean {
  let url: URL
  try {
    url = new URL(input)
  } catch {
    return false
  }
  if (url.username || url.password || url.hash) return false
  if (url.protocol === 'https:') return url.hostname.length > 0 && (url.port === '' || url.port !== '0')
  if (url.protocol === 'http:') {
    const host = url.hostname.toLowerCase()
    return host === '127.0.0.1' || host === 'localhost' || host === '[::1]' || host === '::1'
  }
  return false
}
