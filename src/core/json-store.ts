import { randomUUID } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'

/**
 * Reads a JSON-backed user store without allowing a failed read to turn into
 * an empty-store overwrite. Invalid data is copied beside the store first so
 * its owner can recover it while the app starts with safe defaults.
 */
export async function readJsonStore<T>(
  file: string,
  label: string,
  isValid: (value: unknown) => value is T
): Promise<T | undefined> {
  let raw: Buffer
  try {
    raw = await readFile(file)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
    throw error
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(raw.toString('utf8'))
  } catch (error) {
    await preserveInvalidStore(file, raw, label, error)
    return undefined
  }

  if (!isValid(parsed)) {
    await preserveInvalidStore(file, raw, label, new Error('The saved JSON has an unsupported structure.'))
    return undefined
  }
  return parsed
}

async function preserveInvalidStore(file: string, raw: Buffer, label: string, reason: unknown): Promise<void> {
  const extension = path.extname(file)
  const stem = path.basename(file, extension)
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
  const backup = path.join(path.dirname(file), `${stem}.corrupt-${timestamp}-${randomUUID()}${extension}`)
  await writeFile(backup, raw, { flag: 'wx', mode: 0o600 })
  console.warn(`[${label}] invalid saved file preserved at ${backup}; starting with defaults`, reason)
}
