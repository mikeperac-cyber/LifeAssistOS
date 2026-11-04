import { domainToASCII } from 'node:url'
import { isIP } from 'node:net'
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import path from 'node:path'

interface AllowlistFile {
  version: 1
  hosts: string[]
}

/** Exact HTTPS hosts a user has chosen to allow for read-only web fetches. */
export class DomainAllowlistStore {
  private hosts = new Set<string>()
  private mutationQueue: Promise<void> = Promise.resolve()

  constructor(private readonly file: string) {}

  async init(): Promise<void> {
    await this.mutate(async () => {
      await mkdir(path.dirname(this.file), { recursive: true })
      let next = new Set<string>()
      try {
        const parsed = JSON.parse(await readFile(this.file, 'utf8')) as AllowlistFile
        next = new Set(
          Array.isArray(parsed.hosts)
            ? parsed.hosts.map(normalizeDomain).filter((host): host is string => host !== null)
            : []
        )
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
          console.warn('[allowlist] could not read domains file; starting empty', error)
        }
      }
      await this.persist(next)
      this.hosts = next
    })
  }

  list(): string[] {
    return [...this.hosts].sort((a, b) => a.localeCompare(b))
  }

  allows(host: string): boolean {
    const normalized = normalizeDomain(host)
    return normalized !== null && this.hosts.has(normalized)
  }

  async add(input: string): Promise<string[]> {
    const domain = normalizeDomain(input)
    if (!domain) throw new Error('Enter a valid public domain, such as example.com.')
    return this.mutate(async () => {
      const next = new Set(this.hosts)
      next.add(domain)
      await this.persist(next)
      this.hosts = next
      return this.list()
    })
  }

  async remove(input: string): Promise<string[]> {
    const domain = normalizeDomain(input)
    if (!domain) throw new Error('That domain is not allowlisted.')
    return this.mutate(async () => {
      const next = new Set(this.hosts)
      if (!next.delete(domain)) throw new Error('That domain is not allowlisted.')
      await this.persist(next)
      this.hosts = next
      return this.list()
    })
  }

  private mutate<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.mutationQueue.then(operation, operation)
    this.mutationQueue = result.then(() => undefined, () => undefined)
    return result
  }

  private async persist(hosts: Set<string>): Promise<void> {
    const payload: AllowlistFile = { version: 1, hosts: [...hosts].sort((a, b) => a.localeCompare(b)) }
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

export function normalizeDomain(input: string): string | null {
  const trimmed = input.trim().replace(/\.$/, '').toLowerCase()
  if (!trimmed || trimmed.includes('*') || trimmed.includes('/') || trimmed.includes(':')) return null

  const ascii = domainToASCII(trimmed)
  if (
    !ascii ||
    ascii.length > 253 ||
    isIP(ascii) !== 0 ||
    ascii === 'localhost' ||
    /\.(local|localhost|localdomain|internal|test|invalid|example|lan|corp)$/.test(ascii) ||
    ascii === 'home.arpa' ||
    !ascii.includes('.')
  ) return null
  if (ascii.split('.').some((label) => !label || label.length > 63 || !/^[a-z0-9-]+$/.test(label))) {
    return null
  }

  return ascii
}
