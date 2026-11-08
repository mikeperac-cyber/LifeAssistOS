import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'node:crypto'
import { copyFile, lstat, mkdir, mkdtemp, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { DatabaseSync } from 'node:sqlite'
import { tmpdir } from 'node:os'
import path from 'node:path'
import type { PlanningStore } from './planning'

const TASK_FILES = ['settings.json', 'planning.sqlite'] as const
const LEGACY_FILES = new Set([
  ...TASK_FILES, 'conversations.sqlite', 'finance.sqlite', 'memory.sqlite', 'research.sqlite', 'vault.sqlite',
  'coaching.sqlite', 'file-checkpoints.sqlite', 'grants.json', 'allowed-domains.json', 'speech.json',
  'workflows.json', 'skills.json', 'mcp-servers.json', 'web-search.json', 'notion.json',
  'google-calendar.json', 'google-gmail.json', 'google-drive.json', 'google-tasks.json',
  'microsoft-todo.json', 'microsoft-calendar.json', 'microsoft-mail.json', 'microsoft-onedrive.json',
  'scheduled-tasks.json'
])
const PENDING = '.mike-assist-restore-pending-'
const COMMITTED = '.mike-assist-restore-committed-'
const TRANSACTION_FILE = 'transaction.json'

export interface BackupManifest {
  formatVersion: number
  appVersion: string
  createdAt: string
  encrypted?: boolean
  includes: string[]
}

export interface BackupVerification {
  valid: boolean
  encrypted: boolean
  appVersion?: string
  createdAt?: string
  includes?: string[]
  error?: string
}

interface EncryptedEnvelope { salt: string; iv: string; tag: string; ciphertext: string }
interface ArchivePayload { files: Record<string, string> }
interface RestoreManifest { version: 1 | 2; previousEntries: string[]; entries?: string[] }

export class BackupRestoreRestartRequiredError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options)
    this.name = 'BackupRestoreRestartRequiredError'
  }
}

/** Writes a portable snapshot of the current focused app data. */
export async function createBackupSnapshot(
  userDataDir: string,
  destination: string,
  planning: PlanningStore,
  appVersion: string,
  options?: { settingsFile?: string; passphrase?: string }
): Promise<void> {
  const source = path.resolve(userDataDir)
  const target = path.resolve(destination)
  if (isInside(source, target)) throw new Error('Choose a backup location outside Mike Assist app data.')
  const stage = `${target}.tmp-${randomBytes(8).toString('hex')}`
  const passphrase = options?.passphrase?.trim() ?? ''

  try {
    await mkdir(path.dirname(target), { recursive: true })
    await mkdir(stage)
    const settingsFile = path.resolve(options?.settingsFile ?? path.join(source, 'settings.json'))
    if (!isInside(source, settingsFile) || path.basename(settingsFile) !== 'settings.json') {
      throw new Error('The settings file must be inside Mike Assist app data.')
    }
    await copyRegularFile(settingsFile, path.join(stage, 'settings.json'))
    await planning.backupTo(path.join(stage, 'planning.sqlite'))

    if (passphrase) {
      const files: Record<string, string> = {}
      for (const name of TASK_FILES) files[name] = (await readFile(path.join(stage, name))).toString('base64')
      await rm(path.join(stage, 'settings.json'))
      await rm(path.join(stage, 'planning.sqlite'))
      await writeFile(path.join(stage, 'archive.enc'), `${JSON.stringify(encryptArchive({ files }, passphrase), null, 2)}\n`, { flag: 'wx', mode: 0o600 })
    }

    const manifest: BackupManifest = {
      formatVersion: 2,
      appVersion,
      createdAt: new Date().toISOString(),
      ...(passphrase ? { encrypted: true } : {}),
      includes: [...TASK_FILES]
    }
    await writeFile(path.join(stage, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, { flag: 'wx', mode: 0o600 })
    await rename(stage, target)
  } catch (error) {
    await rm(stage, { recursive: true, force: true }).catch(() => undefined)
    throw error
  }
}

export async function verifyBackupSnapshot(
  backupDir: string,
  options?: { passphrase?: string }
): Promise<BackupVerification> {
  const source = path.resolve(backupDir)
  let manifest: BackupManifest
  try {
    const value: unknown = JSON.parse(await readFile(path.join(source, 'manifest.json'), 'utf8'))
    if (!isRecord(value)) return invalid('Missing or invalid manifest.json in backup folder.')
    manifest = value as unknown as BackupManifest
  } catch { return invalid('Missing or invalid manifest.json in backup folder.') }
  if (!isValidManifest(manifest)) return invalid('Unsupported or incomplete backup manifest.', Boolean(manifest.encrypted))

  const metadata = {
    encrypted: Boolean(manifest.encrypted), appVersion: manifest.appVersion,
    createdAt: manifest.createdAt, includes: manifest.includes
  }
  if (metadata.encrypted) {
    const passphrase = options?.passphrase?.trim() ?? ''
    if (!passphrase) return { valid: false, ...metadata, error: 'A passphrase is required to unlock this encrypted backup.' }
    try {
      const envelope = JSON.parse(await readFile(path.join(source, 'archive.enc'), 'utf8')) as EncryptedEnvelope
      const payload = decryptArchive(envelope, passphrase)
      validateArchiveFiles(payload, manifest)
      const contentError = await verifyEncryptedContents(payload.files)
      return contentError ? { valid: false, ...metadata, error: contentError } : { valid: true, ...metadata }
    } catch (error) {
      if (error instanceof Error && error.message.startsWith('Backup')) return { valid: false, ...metadata, error: error.message }
      return { valid: false, ...metadata, error: 'Could not decrypt backup archive. Check your passphrase.' }
    }
  }

  try {
    for (const name of manifest.includes) {
      const item = name === 'audit/' ? path.join(source, 'audit') : path.join(source, name)
      const info = await lstat(item)
      if (info.isSymbolicLink() || (name === 'audit/' ? !info.isDirectory() : !info.isFile())) {
        return { valid: false, ...metadata, error: `Backup is missing required entry: ${name}` }
      }
    }
    const settingsError = await verifySettingsFile(path.join(source, 'settings.json'))
    if (settingsError) return { valid: false, ...metadata, error: settingsError }
    if (manifest.includes.includes('planning.sqlite')) verifySqliteFile(path.join(source, 'planning.sqlite'))
    return { valid: true, ...metadata }
  } catch (error) {
    return { valid: false, ...metadata, error: error instanceof Error ? error.message : 'Backup contents could not be validated.' }
  }
}

export async function restoreBackupSnapshot(
  backupDir: string,
  userDataDir: string,
  options?: {
    passphrase?: string
    closeStores?: () => void | Promise<void>
    reopenStores?: () => Promise<void>
  }
): Promise<{ restoredFiles: string[] }> {
  const source = path.resolve(backupDir)
  const destination = path.resolve(userDataDir)
  if (isInside(destination, source)) throw new Error('Cannot restore from a folder inside Mike Assist app data.')
  const verification = await verifyBackupSnapshot(source, { passphrase: options?.passphrase })
  if (!verification.valid || !verification.includes) throw new Error(verification.error ?? 'Backup verification failed.')
  const files = await readRestorableFiles(source, verification, options?.passphrase)

  let transactionDir: string | undefined
  let recoveryRequired = false
  let restoreError: unknown
  try {
    await options?.closeStores?.()
    await mkdir(destination, { recursive: true })
    transactionDir = await createRestoreTransaction(destination, Object.keys(files))
    for (const [name, bytes] of Object.entries(files)) {
      const target = path.join(destination, name)
      if (name === 'planning.sqlite') {
        await rm(`${target}-wal`, { force: true })
        await rm(`${target}-shm`, { force: true })
      }
      await writeFile(target, bytes, { mode: 0o600 })
    }
    await commitRestoreTransaction(transactionDir)
    transactionDir = undefined
    return { restoredFiles: Object.keys(files) }
  } catch (error) {
    restoreError = error
    if (transactionDir) {
      try {
        const manifest = await readTransactionManifest(transactionDir)
        if (manifest) await rollbackRestoreTransaction(transactionDir, destination, manifest)
        await commitRestoreTransaction(transactionDir)
        transactionDir = undefined
      } catch (rollbackError) {
        recoveryRequired = true
        throw new BackupRestoreRestartRequiredError(
          'The restore failed and automatic rollback could not finish. Mike Assist must restart to recover the previous data.',
          { cause: new AggregateError([error, rollbackError]) }
        )
      }
    }
    throw error
  } finally {
    if (!recoveryRequired) {
      try { await options?.reopenStores?.() }
      catch (error) {
        throw new BackupRestoreRestartRequiredError(
          'Mike Assist could not reopen its stores after restore. The app must restart to reload its data.',
          { cause: restoreError === undefined ? error : new AggregateError([restoreError, error]) }
        )
      }
    }
  }
}

/** Restores an interrupted focused-data transaction before application stores open. */
export async function recoverInterruptedBackupRestore(userDataDir: string): Promise<void> {
  const destination = path.resolve(userDataDir)
  let entries
  try { entries = await readdir(destination, { withFileTypes: true }) }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return
    throw error
  }
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.isSymbolicLink()) continue
    if (new RegExp(`^${COMMITTED}[a-f0-9]{16}$`).test(entry.name)) {
      await rm(path.join(destination, entry.name), { recursive: true, force: true }).catch(() => undefined)
      continue
    }
    if (!new RegExp(`^${PENDING}[a-f0-9]{16}(?:[a-f0-9]{8})?$`).test(entry.name)) continue
    const transactionDir = path.join(destination, entry.name)
    const manifest = await readTransactionManifest(transactionDir)
    if (!manifest) continue
    if (manifest.version === 2) {
      await rollbackRestoreTransaction(transactionDir, destination, manifest)
      await commitRestoreTransaction(transactionDir)
      console.warn('[backup] recovered an interrupted task-data restore')
    } else {
      await rollbackLegacyFocusedFiles(transactionDir, destination, manifest)
      const preserved = path.join(destination, `.mike-assist-legacy-restore-preserved-${entry.name.slice(PENDING.length)}`)
      await rename(transactionDir, preserved)
    }
  }
}

function isValidManifest(value: BackupManifest): boolean {
  if (!isRecord(value) || ![1, 2].includes(value.formatVersion) || typeof value.appVersion !== 'string' ||
    typeof value.createdAt !== 'string' || (value.encrypted !== undefined && typeof value.encrypted !== 'boolean') ||
    !Array.isArray(value.includes) || value.includes.length === 0 || new Set(value.includes).size !== value.includes.length) return false
  const safeEntries = value.includes.every((name) => name === 'audit/' || (typeof name === 'string' && LEGACY_FILES.has(name)))
  return safeEntries && value.includes.includes('settings.json') &&
    (value.formatVersion === 1 || value.includes.includes('planning.sqlite'))
}

function validateArchiveFiles(payload: ArchivePayload, manifest: BackupManifest): void {
  if (!isRecord(payload) || !isRecord(payload.files)) throw new Error('Backup archive has an invalid file list.')
  for (const [name, encoded] of Object.entries(payload.files)) {
    const allowed = LEGACY_FILES.has(name) && manifest.includes.includes(name) ||
      manifest.includes.includes('audit/') && /^audit\/[A-Za-z0-9._-]{1,120}\.jsonl$/.test(name)
    if (!allowed || typeof encoded !== 'string' || !isCanonicalBase64(encoded)) {
      throw new Error('Backup archive contains an unsafe or unexpected entry.')
    }
  }
  for (const name of manifest.includes) {
    if (name !== 'audit/' && !(name in payload.files)) throw new Error(`Backup archive is missing expected file: ${name}`)
  }
}

async function verifyEncryptedContents(encoded: Record<string, string>): Promise<string | undefined> {
  const directory = await mkdtemp(path.join(tmpdir(), 'mike-assist-backup-verify-'))
  try {
    for (const name of TASK_FILES) {
      if (encoded[name] === undefined) {
        if (name === 'planning.sqlite') continue
        return `Backup is missing required entry: ${name}`
      }
      await writeFile(path.join(directory, name), Buffer.from(encoded[name]!, 'base64'), { flag: 'wx' })
    }
    const settingsError = await verifySettingsFile(path.join(directory, 'settings.json'))
    if (settingsError) return settingsError
    try {
      await lstat(path.join(directory, 'planning.sqlite'))
      verifySqliteFile(path.join(directory, 'planning.sqlite'))
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') return 'Backup database failed its SQLite integrity check: planning.sqlite'
    }
    return undefined
  } catch { return 'Encrypted backup contents could not be validated.' }
  finally { await rm(directory, { recursive: true, force: true }).catch(() => undefined) }
}

async function verifySettingsFile(file: string): Promise<string | undefined> {
  try {
    const value: unknown = JSON.parse(await readFile(file, 'utf8'))
    return isRecord(value) && isRecord(value.provider) ? undefined : 'Backup settings file is invalid.'
  } catch { return 'Backup settings file is missing or invalid.' }
}

function verifySqliteFile(file: string): void {
  const database = new DatabaseSync(file, { readOnly: true })
  try {
    const check = database.prepare('PRAGMA quick_check').all() as Array<Record<string, unknown>>
    const tables = database.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as Array<{ name: string }>
    if (check.length !== 1 || Object.values(check[0] ?? {})[0] !== 'ok' || !tables.some((table) => table.name === 'tasks')) {
      throw new Error('Backup database failed its SQLite integrity check: planning.sqlite')
    }
  } finally { database.close() }
}

async function readRestorableFiles(source: string, verification: BackupVerification, passphrase?: string): Promise<Record<string, Buffer>> {
  const files: Record<string, Buffer> = {}
  if (verification.encrypted) {
    const envelope = JSON.parse(await readFile(path.join(source, 'archive.enc'), 'utf8')) as EncryptedEnvelope
    const payload = decryptArchive(envelope, passphrase?.trim() ?? '')
    const manifest = JSON.parse(await readFile(path.join(source, 'manifest.json'), 'utf8')) as BackupManifest
    validateArchiveFiles(payload, manifest)
    for (const name of TASK_FILES) if (payload.files[name] !== undefined) files[name] = Buffer.from(payload.files[name]!, 'base64')
  } else {
    for (const name of TASK_FILES) if (verification.includes?.includes(name)) files[name] = await readFile(path.join(source, name))
  }
  return files
}

async function copyRegularFile(source: string, destination: string): Promise<void> {
  const info = await lstat(source)
  if (!info.isFile() || info.isSymbolicLink()) throw new Error('Backup source must be a regular file.')
  await copyFile(source, destination)
}

async function createRestoreTransaction(destination: string, entries: string[]): Promise<string> {
  const directory = path.join(destination, `${PENDING}${randomBytes(8).toString('hex')}`)
  const previousDirectory = path.join(directory, 'previous')
  await mkdir(previousDirectory, { recursive: true })
  try {
    const previousEntries: string[] = []
    for (const name of TASK_FILES) {
      try {
        const info = await lstat(path.join(destination, name))
        if (!info.isFile() || info.isSymbolicLink()) throw new Error(`Cannot restore because ${name} is not a regular file.`)
        await copyFile(path.join(destination, name), path.join(previousDirectory, name))
        previousEntries.push(name)
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
      }
    }
    const manifest: RestoreManifest = { version: 2, entries, previousEntries }
    await writeFile(path.join(directory, TRANSACTION_FILE), `${JSON.stringify(manifest, null, 2)}\n`, { flag: 'wx', mode: 0o600 })
    return directory
  } catch (error) {
    await rm(directory, { recursive: true, force: true }).catch(() => undefined)
    throw error
  }
}

async function readTransactionManifest(directory: string): Promise<RestoreManifest | undefined> {
  let raw: string
  try { raw = await readFile(path.join(directory, TRANSACTION_FILE), 'utf8') }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
    throw error
  }
  try {
    const value: unknown = JSON.parse(raw)
    if (!isRecord(value) || (value.version !== 1 && value.version !== 2) || !Array.isArray(value.previousEntries) ||
      !value.previousEntries.every((name) => name === 'audit/' || (typeof name === 'string' && LEGACY_FILES.has(name))) ||
      (value.version === 2 && (!Array.isArray(value.entries) || !value.entries.every((name) => TASK_FILES.includes(name as typeof TASK_FILES[number])))) ||
      new Set(value.previousEntries).size !== value.previousEntries.length) throw new Error('unsupported')
    return value as unknown as RestoreManifest
  } catch (error) {
    if (error instanceof Error && error.message === 'unsupported') {
      throw new Error('An interrupted restore has an unsupported recovery manifest; its files were left untouched.')
    }
    throw new Error('An interrupted restore has an invalid recovery manifest; its files were left untouched.')
  }
}

async function rollbackRestoreTransaction(directory: string, destination: string, manifest: RestoreManifest): Promise<void> {
  const previousDirectory = path.join(directory, 'previous')
  const affected = manifest.entries ?? []
  const previous = manifest.previousEntries.filter((name) => TASK_FILES.includes(name as typeof TASK_FILES[number]))
  for (const name of previous) {
    const info = await lstat(path.join(previousDirectory, name))
    if (!info.isFile() || info.isSymbolicLink()) throw new Error(`Restore checkpoint is missing a valid copy of ${name}.`)
  }
  for (const name of affected) await rm(path.join(destination, name), { force: true })
  for (const name of previous) await copyFile(path.join(previousDirectory, name), path.join(destination, name))
  if (affected.includes('planning.sqlite')) {
    await rm(path.join(destination, 'planning.sqlite-wal'), { force: true })
    await rm(path.join(destination, 'planning.sqlite-shm'), { force: true })
  }
}

async function rollbackLegacyFocusedFiles(directory: string, destination: string, manifest: RestoreManifest): Promise<void> {
  for (const name of TASK_FILES) {
    if (!manifest.previousEntries.includes(name)) continue
    try {
      const info = await lstat(path.join(directory, 'previous', name))
      if (info.isFile() && !info.isSymbolicLink()) await copyFile(path.join(directory, 'previous', name), path.join(destination, name))
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }
  }
  console.warn('[backup] preserved an older full-assistant restore checkpoint and its legacy data')
}

async function commitRestoreTransaction(directory: string): Promise<void> {
  const id = path.basename(directory).slice(PENDING.length)
  const committed = path.join(path.dirname(directory), `${COMMITTED}${id}`)
  await rename(directory, committed)
  await rm(committed, { recursive: true, force: true }).catch((error) => {
    console.warn('[backup] completed restore checkpoint cleanup will retry on next startup', error)
  })
}

function encryptArchive(payload: ArchivePayload, passphrase: string): EncryptedEnvelope {
  const salt = randomBytes(16)
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', scryptSync(passphrase, salt, 32), iv)
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(payload), 'utf8'), cipher.final()])
  return { salt: salt.toString('base64'), iv: iv.toString('base64'), tag: cipher.getAuthTag().toString('base64'), ciphertext: ciphertext.toString('base64') }
}

function decryptArchive(envelope: EncryptedEnvelope, passphrase: string): ArchivePayload {
  if (!isRecord(envelope) || !['salt', 'iv', 'tag', 'ciphertext'].every((name) => typeof (envelope as unknown as Record<string, unknown>)[name] === 'string')) {
    throw new Error('Invalid encrypted archive envelope.')
  }
  const salt = Buffer.from(envelope.salt, 'base64')
  const iv = Buffer.from(envelope.iv, 'base64')
  const tag = Buffer.from(envelope.tag, 'base64')
  const ciphertext = Buffer.from(envelope.ciphertext, 'base64')
  if (salt.length !== 16 || iv.length !== 12 || tag.length !== 16 || !isCanonicalBase64(envelope.ciphertext)) throw new Error('Invalid encrypted archive envelope.')
  const decipher = createDecipheriv('aes-256-gcm', scryptSync(passphrase, salt, 32), iv)
  decipher.setAuthTag(tag)
  return JSON.parse(Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8')) as ArchivePayload
}

function isCanonicalBase64(value: string): boolean { return Buffer.from(value, 'base64').toString('base64') === value }
function isRecord(value: unknown): value is Record<string, unknown> { return Boolean(value) && typeof value === 'object' && !Array.isArray(value) }
function invalid(error: string, encrypted = false): BackupVerification { return { valid: false, encrypted, error } }
function isInside(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate)
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative))
}
