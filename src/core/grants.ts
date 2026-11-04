import { randomUUID } from 'node:crypto'
import { mkdir, realpath, rename, rm, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import type { FolderGrant, GrantLookup } from '../shared/types'
import { ToolError } from '../tools/paths'
import { readJsonStore } from './json-store'

const PRIMARY_ID = 'workspace'
const PRIMARY_LABEL = 'Workspace'

interface GrantsFile {
  version: 1
  grants: FolderGrant[]
}

/**
 * The set of folders the user has approved. Every path-scoped tool resolves
 * against this store, and the gateway re-reads it at execution time so a
 * revoked grant cannot be used by a call that was already approved.
 */
export class GrantStore implements GrantLookup {
  private grants: FolderGrant[] = []
  private mutationQueue: Promise<void> = Promise.resolve()

  constructor(private readonly file: string) {}

  async init(defaultRoot: string): Promise<void> {
    await this.mutate(async () => {
      await mkdir(path.dirname(this.file), { recursive: true })
      const canonicalDefault = await realpath(defaultRoot)

      const parsed = await readJsonStore<GrantsFile>(this.file, 'grants', isGrantsFile)
      const loaded = parsed?.grants ?? []

      const primary = loaded.find((grant) => grant.builtIn)
      const others = loaded.filter((grant) => !grant.builtIn)
      const next: FolderGrant[] = [
        {
          id: primary?.id ?? PRIMARY_ID,
          label: primary?.label ?? PRIMARY_LABEL,
          root: canonicalDefault,
          access: 'read-write',
          createdAt: primary?.createdAt ?? new Date().toISOString(),
          builtIn: true
        },
        ...others
      ]

      await this.persist(next)
      this.grants = next
    })
  }

  list(): FolderGrant[] {
    return this.grants.map((grant) => ({ ...grant }))
  }

  primary(): FolderGrant {
    const primary = this.grants.find((grant) => grant.builtIn)
    if (!primary) throw new ToolError('The workspace grant is missing.')
    return { ...primary }
  }

  /** Resolves by id, then by label (case-insensitive), then common aliases. */
  get(idOrLabel?: string): FolderGrant {
    const key = (idOrLabel ?? '').trim()
    if (!key || /^(workspace|primary|default|main)$/i.test(key)) {
      return this.primary()
    }

    const byId = this.grants.find((grant) => grant.id === key)
    if (byId) return { ...byId }

    const byLabel = this.grants.find((grant) => grant.label.toLowerCase() === key.toLowerCase())
    if (byLabel) return { ...byLabel }

    const available = this.grants.map((grant) => grant.label).join(', ')
    throw new ToolError(`There is no approved folder called "${key}". Available: ${available}.`)
  }

  async add(input: { folderPath: string; label?: string; access: 'read' | 'read-write' }): Promise<FolderGrant> {
    return this.mutate(async () => {
      const canonical = await canonicalFolder(input.folderPath)
      if (this.grants.some((grant) => samePath(grant.root, canonical))) {
        throw new ToolError('That folder is already approved.')
      }

      const label = (input.label ?? path.basename(canonical) ?? canonical).trim() || path.basename(canonical)
      const clash = this.grants.find((grant) => grant.label.toLowerCase() === label.toLowerCase())
      const uniqueLabel = clash ? `${label} (${this.grants.length + 1})` : label
      const grant: FolderGrant = {
        id: randomUUID(),
        label: uniqueLabel,
        root: canonical,
        access: input.access,
        createdAt: new Date().toISOString()
      }

      const next = [...this.grants, grant]
      await this.persist(next)
      this.grants = next
      return { ...grant }
    })
  }

  async remove(id: string): Promise<FolderGrant> {
    return this.mutate(async () => {
      const index = this.grants.findIndex((grant) => grant.id === id)
      if (index === -1) throw new ToolError('That folder is not approved.')
      if (this.grants[index].builtIn) throw new ToolError('The workspace folder cannot be removed.')
      const removed = this.grants[index]
      const next = this.grants.filter((grant) => grant.id !== id)
      await this.persist(next)
      this.grants = next
      return { ...removed }
    })
  }

  async setAccess(id: string, access: 'read' | 'read-write'): Promise<FolderGrant> {
    return this.mutate(async () => {
      const grant = this.grants.find((entry) => entry.id === id)
      if (!grant) throw new ToolError('That folder is not approved.')
      if (grant.builtIn && access !== 'read-write') {
        throw new ToolError('The workspace folder must stay writable.')
      }
      if (grant.access === access) return { ...grant }

      const updated = { ...grant, access }
      const next = this.grants.map((entry) => entry.id === id ? updated : entry)
      await this.persist(next)
      this.grants = next
      return { ...updated }
    })
  }

  private mutate<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.mutationQueue.then(operation, operation)
    this.mutationQueue = result.then(() => undefined, () => undefined)
    return result
  }

  private async persist(grants: FolderGrant[]): Promise<void> {
    const payload: GrantsFile = { version: 1, grants }
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

function isValidGrant(value: unknown): value is FolderGrant {
  if (!value || typeof value !== 'object') return false
  const grant = value as Partial<FolderGrant>
  return (
    typeof grant.id === 'string' &&
    typeof grant.label === 'string' &&
    typeof grant.root === 'string' &&
    (grant.access === 'read' || grant.access === 'read-write')
  )
}

function isGrantsFile(value: unknown): value is GrantsFile {
  if (!value || typeof value !== 'object') return false
  const file = value as Partial<GrantsFile>
  return file.version === 1 && Array.isArray(file.grants) && file.grants.every(isValidGrant)
}

async function canonicalFolder(input: string): Promise<string> {
  if (!input || input.includes('\0')) {
    throw new ToolError('That folder path is invalid.')
  }
  if (input.startsWith('\\\\') || input.startsWith('//')) {
    throw new ToolError('Network paths are not supported. Choose a folder on this computer.')
  }
  if (!path.isAbsolute(input)) {
    throw new ToolError('Choose an absolute folder path.')
  }

  let canonical: string
  try {
    canonical = await realpath(input)
  } catch {
    throw new ToolError('That folder does not exist.')
  }

  const info = await stat(canonical)
  if (!info.isDirectory()) {
    throw new ToolError('That is a file, not a folder.')
  }

  return canonical
}

function samePath(a: string, b: string): boolean {
  const normalize = (value: string): string => {
    const trimmed = value.replace(/[\\/]+$/, '')
    return process.platform === 'win32' ? trimmed.toLowerCase() : trimmed
  }
  return normalize(a) === normalize(b)
}
