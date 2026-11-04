import { domainToASCII } from 'node:url'
import { isIP } from 'node:net'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import path from 'node:path'

interface AllowlistFile {
  version: 1
  hosts: string[]
}

/** Exact HTTPS hosts a user has chosen to allow for read-only web fetches. */
export class DomainAllowlistStore {
  private hosts = new Set<string>()

  constructor(private readonly file: string) {}

  async init(): Promise<void> {
    await mkdir(path.dirname(this.file), { recursive: true })
    try {
      const parsed = JSON.parse(await readFile(this.file, 'utf8')) as AllowlistFile
      this.hosts = new Set(
        Array.isArray(parsed.hosts)
          ? parsed.hosts.map(normalizeDomain).filter((host): host is string => host !== null)
          : []
      )
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        console.warn('[allowlist] could not read domains file; starting empty', error)
      }
      this.hosts = new Set()
    }
    await this.persist()
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
    this.hosts.add(domain)
    await this.persist()
    return this.list()
  }

  async remove(input: string): Promise<string[]> {
    const domain = normalizeDomain(input)
    if (!domain || !this.hosts.delete(domain)) throw new Error('That domain is not allowlisted.')
    await this.persist()
    return this.list()
  }

  private async persist(): Promise<void> {
    const payload: AllowlistFile = { version: 1, hosts: this.list() }
    const temporary = `${this.file}.tmp`
    await writeFile(temporary, `${JSON.stringify(payload, null, 2)}\n`, 'utf8')
    await rename(temporary, this.file)
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
