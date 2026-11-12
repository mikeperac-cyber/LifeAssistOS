import { randomUUID } from 'node:crypto'
import { mkdir, readFile, realpath, rename, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import type { LocalDocument } from '../shared/ipc'

type StoredDocument = {
  id: string
  path: string
  name: string
  extension: string
  size: number
  addedAt: string
}

const MAX_DOCUMENTS = 1000
const MAX_PICK_SIZE = 100
const ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
export const DOCUMENT_ALLOWED_EXTENSIONS = [
  'pdf', 'doc', 'docx', 'odt', 'rtf', 'txt', 'md', 'csv',
  'xls', 'xlsx', 'ppt', 'pptx', 'png', 'jpg', 'jpeg', 'webp'
] as const
const ALLOWED_EXTENSIONS = new Set<string>(DOCUMENT_ALLOWED_EXTENSIONS)

/** Stores local file references only; document bytes stay at the path the user chose. */
export class DocumentLibraryStore {
  private queue: Promise<void> = Promise.resolve()

  constructor(private readonly storagePath: string) {}

  list(): Promise<LocalDocument[]> {
    return this.serialize(async () => {
      const entries = await this.readEntries()
      return Promise.all(entries.map((entry) => this.toPublicDocument(entry)))
    })
  }

  addSelectedPaths(selectedPaths: string[]): Promise<LocalDocument[]> {
    return this.serialize(async () => {
      if (selectedPaths.length > MAX_PICK_SIZE) throw new Error(`Add up to ${MAX_PICK_SIZE} documents at a time.`)
      const entries = await this.readEntries()
      const knownPaths = new Set(entries.map((entry) => this.pathKey(entry.path)))

      for (const selectedPath of selectedPaths) {
        if (typeof selectedPath !== 'string' || selectedPath.length > 4096 || !path.isAbsolute(selectedPath)) continue
        let absolutePath: string
        try { absolutePath = await realpath(path.resolve(selectedPath)) }
        catch { throw new Error('Choose a file that still exists at its saved location.') }
        const extension = path.extname(absolutePath).slice(1).toLocaleLowerCase('en-US')
        if (!ALLOWED_EXTENSIONS.has(extension)) {
          throw new Error('Choose PDF, DOC/DOCX, ODT/RTF, TXT/MD/CSV, XLS/XLSX, PPT/PPTX, or PNG/JPG/WebP files.')
        }
        const key = this.pathKey(absolutePath)
        if (knownPaths.has(key)) continue

        const fileInfo = await stat(absolutePath)
        if (!fileInfo.isFile()) continue
        if (entries.length >= MAX_DOCUMENTS) throw new Error('The local document library is full. Remove a link before adding more files.')

        const name = path.basename(absolutePath)
        const displayExtension = extension.toUpperCase().slice(0, 12)
        entries.push({
          id: randomUUID(), path: absolutePath, name, extension: displayExtension,
          size: fileInfo.size, addedAt: new Date().toISOString()
        })
        knownPaths.add(key)
      }

      await this.writeEntries(entries)
      return Promise.all(entries.map((entry) => this.toPublicDocument(entry)))
    })
  }

  remove(id: string): Promise<boolean> {
    return this.serialize(async () => {
      if (!ID_PATTERN.test(id)) return false
      const entries = await this.readEntries()
      const next = entries.filter((entry) => entry.id !== id)
      if (next.length === entries.length) return false
      await this.writeEntries(next)
      return true
    })
  }

  getExistingPath(id: string): Promise<string | null> {
    return this.serialize(async () => {
      if (!ID_PATTERN.test(id)) return null
      const entry = (await this.readEntries()).find((candidate) => candidate.id === id)
      if (!entry) return null
      return (await this.resolveSafeExistingPath(entry.path))?.path ?? null
    })
  }

  private async toPublicDocument(entry: StoredDocument): Promise<LocalDocument> {
    const existing = await this.resolveSafeExistingPath(entry.path)
    return {
      id: entry.id, name: entry.name, extension: entry.extension,
      size: existing?.size ?? entry.size, addedAt: entry.addedAt, exists: existing !== null
    }
  }

  private async resolveSafeExistingPath(filePath: string): Promise<{ path: string; size: number } | null> {
    try {
      const resolvedPath = await realpath(filePath)
      const extension = path.extname(resolvedPath).slice(1).toLocaleLowerCase('en-US')
      if (!ALLOWED_EXTENSIONS.has(extension)) return null
      const fileInfo = await stat(resolvedPath)
      return fileInfo.isFile() ? { path: resolvedPath, size: fileInfo.size } : null
    } catch {
      return null
    }
  }

  private async readEntries(): Promise<StoredDocument[]> {
    let source: string
    try {
      source = await readFile(this.storagePath, 'utf8')
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
      throw new Error('The local document library could not be read.')
    }

    try {
      const data: unknown = JSON.parse(source)
      if (!isRecord(data) || data.version !== 1 || !Array.isArray(data.documents)) throw new Error('Invalid document library data.')
      return data.documents.filter(isStoredDocument).slice(0, MAX_DOCUMENTS)
    } catch {
      throw new Error('The local document library is invalid. Its original files have not been changed.')
    }
  }

  private async writeEntries(entries: StoredDocument[]): Promise<void> {
    await mkdir(path.dirname(this.storagePath), { recursive: true })
    const temporaryPath = `${this.storagePath}.tmp`
    await writeFile(temporaryPath, JSON.stringify({ version: 1, documents: entries }), { encoding: 'utf8', mode: 0o600 })
    await rename(temporaryPath, this.storagePath)
  }

  private pathKey(value: string): string {
    const normalized = path.resolve(value)
    return process.platform === 'win32' ? normalized.toLocaleLowerCase('en-US') : normalized
  }

  private async serialize<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.queue.then(operation)
    this.queue = result.then(() => undefined, () => undefined)
    return result
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isStoredDocument(value: unknown): value is StoredDocument {
  if (!isRecord(value)) return false
  if (typeof value['path'] !== 'string' || value['path'].length > 4096 || !path.isAbsolute(value['path'])) return false
  const extension = path.extname(value['path']).slice(1).toLocaleLowerCase('en-US')
  if (!ALLOWED_EXTENSIONS.has(extension)) return false
  return typeof value['id'] === 'string' && ID_PATTERN.test(value['id']) &&
    typeof value['name'] === 'string' && value['name'].length > 0 && value['name'].length <= 512 &&
    typeof value['extension'] === 'string' && value['extension'].length <= 12 &&
    typeof value['size'] === 'number' && Number.isSafeInteger(value['size']) && value['size'] >= 0 &&
    typeof value['addedAt'] === 'string' && Number.isFinite(Date.parse(value['addedAt']))
}
