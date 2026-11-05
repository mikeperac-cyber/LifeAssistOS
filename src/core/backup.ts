import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'node:crypto'
import { copyFile, cp, lstat, mkdir, mkdtemp, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { DatabaseSync } from 'node:sqlite'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { AuditLog } from './audit/log'
import type { ConversationStore } from './conversations'
import type { FinanceStore } from './finance'
import type { MemoryStore } from './memory'
import type { ResearchStore } from './research'
import type { VaultStore } from './vault'
import type { PlanningStore } from './planning'
import type { CoachingStore } from './coaching'
import type { FileCheckpointStore } from './file-checkpoints'
import { isPathInside } from '../tools/paths'

const DATA_FILES = [
  'settings.json',
  'grants.json',
  'allowed-domains.json',
  'speech.json',
  'workflows.json',
  'skills.json'
]
const OPTIONAL_DATA_FILES = [
  'mcp-servers.json',
  'web-search.json',
  'google-calendar.json',
  'google-gmail.json',
  'google-drive.json',
  'google-tasks.json',
  'scheduled-tasks.json'
]
const OPTIONAL_DATABASE_FILES = [
  'research.sqlite',
  'vault.sqlite',
  'planning.sqlite',
  'coaching.sqlite',
  'file-checkpoints.sqlite'
]
const BACKUP_ROOT_FILES = new Set([
  'conversations.sqlite',
  'finance.sqlite',
  'memory.sqlite',
  'research.sqlite',
  'vault.sqlite',
  'planning.sqlite',
  'coaching.sqlite',
  'file-checkpoints.sqlite',
  ...DATA_FILES,
  ...OPTIONAL_DATA_FILES
])
const REQUIRED_BACKUP_ENTRIES = [
  'conversations.sqlite',
  'finance.sqlite',
  'memory.sqlite',
  'settings.json',
  'grants.json',
  'allowed-domains.json',
  'audit/'
]
const RESTORE_PENDING_PREFIX = '.mike-assist-restore-pending-'
const RESTORE_COMMITTED_PREFIX = '.mike-assist-restore-committed-'
const RESTORE_TRANSACTION_FILE = 'transaction.json'
const RESTORABLE_ENTRIES = [...BACKUP_ROOT_FILES, 'audit/']
const REQUIRED_DATABASE_TABLES: Record<string, string> = {
  'conversations.sqlite': 'chat_messages',
  'finance.sqlite': 'transactions',
  'memory.sqlite': 'memory_facts',
  'research.sqlite': 'projects',
  'vault.sqlite': 'documents',
  'planning.sqlite': 'tasks',
  'coaching.sqlite': 'goals',
  'file-checkpoints.sqlite': 'file_checkpoints'
}

export interface BackupExtras {
  research?: ResearchStore
  vault?: VaultStore
  planning?: PlanningStore
  coaching?: CoachingStore
  fileCheckpoints?: FileCheckpointStore
  passphrase?: string
}

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

interface EncryptedArchiveEnvelope {
  salt: string
  iv: string
  tag: string
  ciphertext: string
}

interface ArchivePayload {
  files: Record<string, string>
}

interface RestoreTransactionManifest {
  version: 1
  previousEntries: string[]
}

export class BackupRestoreRestartRequiredError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options)
    this.name = 'BackupRestoreRestartRequiredError'
  }
}

/** Writes an atomic, consistent directory snapshot of the app's durable data. */
export async function createBackupSnapshot(
  userDataDir: string,
  destination: string,
  conversations: ConversationStore,
  finance: FinanceStore,
  memory: MemoryStore,
  appVersion: string,
  extras?: BackupExtras
): Promise<void> {
  const source = path.resolve(userDataDir)
  const target = path.resolve(destination)
  if (isPathInside(source, target)) {
    throw new Error('Choose a backup location outside Mike Assist app data.')
  }

  const passphrase = extras?.passphrase?.trim() ?? ''
  const encrypted = passphrase.length > 0

  let created = false
  try {
    await mkdir(target)
    created = true
    const stageDir = encrypted ? path.join(target, '.staging') : target
    if (encrypted) await mkdir(stageDir, { recursive: true })

    await conversations.backupTo(path.join(stageDir, 'conversations.sqlite'))
    await finance.backupTo(path.join(stageDir, 'finance.sqlite'))
    await memory.backupTo(path.join(stageDir, 'memory.sqlite'))
    const extraBackups: string[] = []
    if (extras?.research) {
      await extras.research.backupTo(path.join(stageDir, 'research.sqlite'))
      extraBackups.push('research.sqlite')
    }
    if (extras?.vault) {
      await extras.vault.backupTo(path.join(stageDir, 'vault.sqlite'))
      extraBackups.push('vault.sqlite')
    }
    if (extras?.planning) {
      await extras.planning.backupTo(path.join(stageDir, 'planning.sqlite'))
      extraBackups.push('planning.sqlite')
    }
    if (extras?.coaching) {
      await extras.coaching.backupTo(path.join(stageDir, 'coaching.sqlite'))
      extraBackups.push('coaching.sqlite')
    }
    if (extras?.fileCheckpoints) {
      await extras.fileCheckpoints.backupTo(path.join(stageDir, 'file-checkpoints.sqlite'))
      extraBackups.push('file-checkpoints.sqlite')
    }
    await Promise.all(
      DATA_FILES.map((name) => copyFile(path.join(source, name), path.join(stageDir, name)))
    )
    const optionalFiles: string[] = []
    for (const name of OPTIONAL_DATA_FILES) {
      try {
        await copyFile(path.join(source, name), path.join(stageDir, name))
        optionalFiles.push(name)
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
      }
    }
    await cp(path.join(source, 'audit'), path.join(stageDir, 'audit'), { recursive: true })

    const includes = [
      'conversations.sqlite',
      'finance.sqlite',
      'memory.sqlite',
      ...extraBackups,
      ...DATA_FILES,
      ...optionalFiles,
      'audit/'
    ]

    if (encrypted) {
      const files = await collectFilesRecursively(stageDir, stageDir)
      await rm(stageDir, { recursive: true, force: true })
      const envelope = encryptArchive({ files }, passphrase)
      await writeFile(path.join(target, 'archive.enc'), JSON.stringify(envelope, null, 2), 'utf8')
    }

    const manifest: BackupManifest = {
      formatVersion: 1,
      appVersion,
      createdAt: new Date().toISOString(),
      ...(encrypted ? { encrypted: true } : {}),
      includes
    }

    await writeFile(
      path.join(target, 'manifest.json'),
      `${JSON.stringify(manifest, null, 2)}\n`,
      'utf8'
    )
  } catch (error) {
    if (created) await rm(target, { recursive: true, force: true }).catch(() => undefined)
    throw error
  }
}

export async function verifyBackupSnapshot(
  backupDir: string,
  options?: { passphrase?: string }
): Promise<BackupVerification> {
  const target = path.resolve(backupDir)
  let manifest: BackupManifest
  try {
    const raw = await readFile(path.join(target, 'manifest.json'), 'utf8')
    const parsed: unknown = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return { valid: false, encrypted: false, error: 'Missing or invalid manifest.json in backup folder.' }
    }
    manifest = parsed as BackupManifest
  } catch {
    return { valid: false, encrypted: false, error: 'Missing or invalid manifest.json in backup folder.' }
  }

  if (
    manifest.formatVersion !== 1 ||
    typeof manifest.appVersion !== 'string' ||
    typeof manifest.createdAt !== 'string' ||
    manifest.encrypted !== undefined && typeof manifest.encrypted !== 'boolean' ||
    !isValidManifestIncludes(manifest.includes)
  ) {
    return { valid: false, encrypted: Boolean(manifest.encrypted), error: 'Unsupported or incomplete backup manifest.' }
  }

  const encrypted = Boolean(manifest.encrypted)
  if (encrypted) {
    const passphrase = options?.passphrase?.trim() ?? ''
    if (!passphrase) {
      return {
        valid: false,
        encrypted: true,
        appVersion: manifest.appVersion,
        createdAt: manifest.createdAt,
        includes: manifest.includes,
        error: 'A passphrase is required to unlock this encrypted backup.'
      }
    }
    try {
      const rawEnvelope = await readFile(path.join(target, 'archive.enc'), 'utf8')
      const envelope = JSON.parse(rawEnvelope) as EncryptedArchiveEnvelope
      const payload = decryptArchive(envelope, passphrase)
      if (
        !payload ||
        typeof payload.files !== 'object' ||
        payload.files === null ||
        Array.isArray(payload.files)
      ) {
        return {
          valid: false,
          encrypted: true,
          error: 'Encrypted backup archive has an invalid file list.'
        }
      }
      for (const [relPath, base64Data] of Object.entries(payload.files)) {
        if (!isAllowedArchiveFile(relPath, manifest.includes) || typeof base64Data !== 'string' ||
          Buffer.from(base64Data, 'base64').toString('base64') !== base64Data) {
          return {
            valid: false,
            encrypted: true,
            error: 'Encrypted backup contains an unsafe or unexpected entry.'
          }
        }
      }
      for (const item of manifest.includes) {
        if (item === 'audit/') continue
        if (!(item in payload.files)) {
          return {
            valid: false,
            encrypted: true,
            error: `Encrypted backup is missing expected file: ${item}`
          }
        }
      }
      const contentError = await verifyEncryptedContents(payload.files, manifest.includes)
      if (contentError) {
        return {
          valid: false,
          encrypted: true,
          appVersion: manifest.appVersion,
          createdAt: manifest.createdAt,
          includes: manifest.includes,
          error: contentError
        }
      }
      return {
        valid: true,
        encrypted: true,
        appVersion: manifest.appVersion,
        createdAt: manifest.createdAt,
        includes: manifest.includes
      }
    } catch {
      return {
        valid: false,
        encrypted: true,
        appVersion: manifest.appVersion,
        createdAt: manifest.createdAt,
        includes: manifest.includes,
        error: 'Could not decrypt backup archive. Check your passphrase.'
      }
    }
  }

  for (const item of manifest.includes) {
    const checkPath = item === 'audit/' ? path.join(target, 'audit') : path.join(target, item)
    try {
      const info = await lstat(checkPath)
      if (info.isSymbolicLink() || (item === 'audit/' ? !info.isDirectory() : !info.isFile())) {
        throw new Error('Backup entry has an unexpected file type.')
      }
      if (item === 'audit/') {
        const entries = await readdir(checkPath, { withFileTypes: true })
        if (entries.some((entry) => !entry.isFile() || !isAuditFileName(entry.name))) {
          throw new Error('Backup audit folder contains an unsupported entry.')
        }
      }
      if (item.endsWith('.sqlite')) {
        try {
          verifySqliteFile(checkPath)
        } catch {
          return {
            valid: false,
            encrypted: false,
            appVersion: manifest.appVersion,
            createdAt: manifest.createdAt,
            includes: manifest.includes,
            error: `Backup database failed its SQLite integrity check: ${item}`
          }
        }
      }
    } catch {
      return {
        valid: false,
        encrypted: false,
        appVersion: manifest.appVersion,
        createdAt: manifest.createdAt,
        includes: manifest.includes,
        error: `Backup is missing required entry: ${item}`
      }
    }
  }

  try {
    const audit = new AuditLog(path.join(target, 'audit'), 'backup-verify')
    await audit.init()
    const integrity = audit.getIntegrity()
    if (!integrity.valid) {
      return {
        valid: false,
        encrypted: false,
        appVersion: manifest.appVersion,
        createdAt: manifest.createdAt,
        includes: manifest.includes,
        error: 'Backup audit log failed hash-chain integrity verification.'
      }
    }
  } catch (error) {
    return {
      valid: false,
      encrypted: false,
      error: error instanceof Error ? error.message : String(error)
    }
  }

  return {
    valid: true,
    encrypted: false,
    appVersion: manifest.appVersion,
    createdAt: manifest.createdAt,
    includes: manifest.includes
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
  if (isPathInside(destination, source)) {
    throw new Error('Cannot restore from a folder inside Mike Assist app data.')
  }

  const verification = await verifyBackupSnapshot(source, { passphrase: options?.passphrase })
  if (!verification.valid || !verification.includes) {
    throw new Error(verification.error ?? 'Backup verification failed.')
  }

  const restoredFiles: string[] = []
  let transactionDir: string | undefined
  let recoveryRequired = false
  let restoreError: unknown
  try {
    await options?.closeStores?.()
    await mkdir(destination, { recursive: true })
    transactionDir = await createRestoreTransaction(destination)

    if (verification.encrypted) {
      const rawEnvelope = await readFile(path.join(source, 'archive.enc'), 'utf8')
      const envelope = JSON.parse(rawEnvelope) as EncryptedArchiveEnvelope
      const payload = decryptArchive(envelope, options!.passphrase!.trim())
      if (!payload || typeof payload.files !== 'object' || payload.files === null || Array.isArray(payload.files)) {
        throw new Error('Encrypted backup archive has an invalid file list.')
      }
      const archiveEntries = Object.entries(payload.files)
      if (archiveEntries.some(([relPath, base64Data]) =>
        !isAllowedArchiveFile(relPath, verification.includes!) || typeof base64Data !== 'string' ||
        Buffer.from(base64Data, 'base64').toString('base64') !== base64Data
      )) {
        throw new Error('Encrypted backup contains an unsafe or unexpected entry.')
      }
      await rm(path.join(destination, 'audit'), { recursive: true, force: true }).catch(() => undefined)
      if (verification.includes.includes('audit/')) {
        await mkdir(path.join(destination, 'audit'), { recursive: true })
      }
      for (const [relPath, base64Data] of archiveEntries) {
        const normalizedRel = relPath.split('/').join(path.sep)
        const targetFile = path.resolve(destination, normalizedRel)
        if (!isPathInside(destination, targetFile)) {
          throw new Error('Encrypted backup entry resolves outside Mike Assist app data.')
        }
        if (targetFile.endsWith('.sqlite')) {
          await rm(`${targetFile}-wal`, { force: true }).catch(() => undefined)
          await rm(`${targetFile}-shm`, { force: true }).catch(() => undefined)
        }
        await mkdir(path.dirname(targetFile), { recursive: true })
        await writeFile(targetFile, Buffer.from(base64Data, 'base64'))
        restoredFiles.push(relPath)
      }
    } else {
      for (const item of verification.includes) {
        if (item === 'audit/') {
          await rm(path.join(destination, 'audit'), { recursive: true, force: true }).catch(() => undefined)
          await copySafeAuditDirectory(path.join(source, 'audit'), path.join(destination, 'audit'))
          restoredFiles.push('audit/')
          continue
        }
        const targetFile = path.resolve(destination, item)
        if (!isPathInside(destination, targetFile)) {
          throw new Error('Backup entry resolves outside Mike Assist app data.')
        }
        if (item.endsWith('.sqlite')) {
          await rm(`${targetFile}-wal`, { force: true }).catch(() => undefined)
          await rm(`${targetFile}-shm`, { force: true }).catch(() => undefined)
        }
        await copyFile(path.join(source, item), targetFile)
        restoredFiles.push(item)
      }
    }
    const included = new Set(verification.includes)
    for (const item of OPTIONAL_DATA_FILES) {
      if (!included.has(item)) {
        await rm(path.join(destination, item), { force: true })
      }
    }
    for (const item of OPTIONAL_DATABASE_FILES) {
      if (!included.has(item)) {
        const targetFile = path.join(destination, item)
        await rm(`${targetFile}-wal`, { force: true })
        await rm(`${targetFile}-shm`, { force: true })
        await rm(targetFile, { force: true })
      }
    }

    await commitRestoreTransaction(transactionDir)
    transactionDir = undefined
    return { restoredFiles }
  } catch (error) {
    restoreError = error
    if (transactionDir) {
      try {
        await rollbackRestoreTransaction(transactionDir, destination)
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
      try {
        await options?.reopenStores?.()
      } catch (error) {
        throw new BackupRestoreRestartRequiredError(
          'Mike Assist could not reopen its stores after restore. The app must restart to reload its data.',
          { cause: restoreError === undefined ? error : new AggregateError([restoreError, error]) }
        )
      }
    }
  }
}

function isValidManifestIncludes(value: unknown): value is string[] {
  return (
    Array.isArray(value) &&
    value.every((entry) => entry === 'audit/' || (typeof entry === 'string' && BACKUP_ROOT_FILES.has(entry))) &&
    new Set(value).size === value.length &&
    REQUIRED_BACKUP_ENTRIES.every((entry) => value.includes(entry))
  )
}

/** Restores a pending transaction before any application store opens its files. */
export async function recoverInterruptedBackupRestore(userDataDir: string): Promise<void> {
  const destination = path.resolve(userDataDir)
  let entries: import('node:fs').Dirent[]
  try {
    entries = await readdir(destination, { withFileTypes: true })
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return
    throw error
  }

  for (const entry of entries) {
    if (/^\.mike-assist-restore-committed-[a-f0-9]{24}$/.test(entry.name)) {
      await rm(path.join(destination, entry.name), { recursive: true, force: true }).catch((error) => {
        console.warn('[backup] completed restore checkpoint cleanup will retry on next startup', error)
      })
      continue
    }
    if (!/^\.mike-assist-restore-pending-[a-f0-9]{24}$/.test(entry.name) || !entry.isDirectory()) continue

    const transactionDir = path.join(destination, entry.name)
    const manifest = await readRestoreTransactionManifest(transactionDir)
    if (manifest) {
      await rollbackRestoreTransaction(transactionDir, destination, manifest)
      await commitRestoreTransaction(transactionDir)
      console.warn('[backup] recovered an interrupted restore and restored the previous app data')
    } else {
      await rm(transactionDir, { recursive: true, force: true }).catch((error) => {
        console.warn('[backup] an unused restore checkpoint could not be cleaned up', error)
      })
    }
  }
}

async function createRestoreTransaction(destination: string): Promise<string> {
  const transactionDir = path.join(destination, `${RESTORE_PENDING_PREFIX}${randomBytes(12).toString('hex')}`)
  const previousDir = path.join(transactionDir, 'previous')
  await mkdir(previousDir, { recursive: true })

  try {
    const previousEntries: string[] = []
    for (const name of BACKUP_ROOT_FILES) {
      const source = path.join(destination, name)
      let info
      try {
        info = await lstat(source)
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue
        throw error
      }
      if (!info.isFile() || info.isSymbolicLink()) {
        throw new Error(`Cannot create a restore checkpoint because ${name} is not a regular file.`)
      }
      await copyFile(source, path.join(previousDir, name))
      previousEntries.push(name)
    }

    const auditSource = path.join(destination, 'audit')
    let auditInfo: Awaited<ReturnType<typeof lstat>> | undefined
    try {
      auditInfo = await lstat(auditSource)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }
    if (auditInfo) {
      if (!auditInfo.isDirectory() || auditInfo.isSymbolicLink()) {
        throw new Error('Cannot create a restore checkpoint because the audit path is not a regular folder.')
      }
      await copySafeAuditDirectory(auditSource, path.join(previousDir, 'audit'))
      previousEntries.push('audit/')
    }

    const manifest: RestoreTransactionManifest = { version: 1, previousEntries }
    const temporaryManifest = path.join(transactionDir, `${RESTORE_TRANSACTION_FILE}.tmp`)
    await writeFile(temporaryManifest, `${JSON.stringify(manifest, null, 2)}\n`, { encoding: 'utf8', flag: 'wx', mode: 0o600 })
    await rename(temporaryManifest, path.join(transactionDir, RESTORE_TRANSACTION_FILE))
    return transactionDir
  } catch (error) {
    await rm(transactionDir, { recursive: true, force: true }).catch(() => undefined)
    throw error
  }
}

async function commitRestoreTransaction(transactionDir: string): Promise<void> {
  const transactionId = path.basename(transactionDir).slice(RESTORE_PENDING_PREFIX.length)
  const committedDir = path.join(path.dirname(transactionDir), `${RESTORE_COMMITTED_PREFIX}${transactionId}`)
  await rename(transactionDir, committedDir)
  await rm(committedDir, { recursive: true, force: true }).catch((error) => {
    console.warn('[backup] completed restore checkpoint cleanup will retry on next startup', error)
  })
}

async function readRestoreTransactionManifest(
  transactionDir: string
): Promise<RestoreTransactionManifest | undefined> {
  let raw: string
  try {
    raw = await readFile(path.join(transactionDir, RESTORE_TRANSACTION_FILE), 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
    throw error
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    throw new Error('An interrupted restore has an invalid recovery manifest; its files were left untouched.')
  }
  if (!isRestoreTransactionManifest(parsed)) {
    throw new Error('An interrupted restore has an unsupported recovery manifest; its files were left untouched.')
  }
  return parsed
}

function isRestoreTransactionManifest(value: unknown): value is RestoreTransactionManifest {
  if (!value || typeof value !== 'object') return false
  const manifest = value as Partial<RestoreTransactionManifest>
  const previousEntries = manifest.previousEntries
  return manifest.version === 1 && Array.isArray(previousEntries) &&
    previousEntries.every((entry) => typeof entry === 'string' && RESTORABLE_ENTRIES.includes(entry)) &&
    new Set(previousEntries).size === previousEntries.length
}

async function rollbackRestoreTransaction(
  transactionDir: string,
  destination: string,
  knownManifest?: RestoreTransactionManifest
): Promise<void> {
  const manifest = knownManifest ?? await readRestoreTransactionManifest(transactionDir)
  if (!manifest) return
  const previousDir = path.join(transactionDir, 'previous')

  // Confirm every checkpoint is present before removing any current app data.
  for (const entry of manifest.previousEntries) {
    const saved = path.join(previousDir, entry === 'audit/' ? 'audit' : entry)
    const info = await lstat(saved)
    if (info.isSymbolicLink() || (entry === 'audit/' ? !info.isDirectory() : !info.isFile())) {
      throw new Error(`The restore checkpoint is missing a valid copy of ${entry}.`)
    }
    if (entry === 'audit/') await validateSafeAuditDirectory(saved)
  }

  for (const entry of RESTORABLE_ENTRIES) {
    const target = path.join(destination, entry === 'audit/' ? 'audit' : entry)
    if (entry.endsWith('.sqlite')) {
      await rm(`${target}-wal`, { force: true })
      await rm(`${target}-shm`, { force: true })
    }
    await rm(target, { recursive: true, force: true })
  }

  for (const entry of manifest.previousEntries) {
    const saved = path.join(previousDir, entry === 'audit/' ? 'audit' : entry)
    const target = path.join(destination, entry === 'audit/' ? 'audit' : entry)
    if (entry === 'audit/') await copySafeAuditDirectory(saved, target)
    else await copyFile(saved, target)
  }
}

async function copySafeAuditDirectory(source: string, destination: string): Promise<void> {
  await validateSafeAuditDirectory(source)
  await mkdir(destination, { recursive: true })
  const entries = await readdir(source, { withFileTypes: true })
  for (const entry of entries) {
    await copyFile(path.join(source, entry.name), path.join(destination, entry.name))
  }
}

async function validateSafeAuditDirectory(directory: string): Promise<void> {
  const info = await lstat(directory)
  if (!info.isDirectory() || info.isSymbolicLink()) {
    throw new Error('Audit data must be a regular folder.')
  }
  const entries = await readdir(directory, { withFileTypes: true })
  if (entries.some((entry) => !entry.isFile() || !isAuditFileName(entry.name))) {
    throw new Error('Audit data must contain only regular JSONL files.')
  }
}

function isAuditFileName(name: string): boolean {
  return /^[A-Za-z0-9._-]{1,120}\.jsonl$/.test(name)
}

async function verifyEncryptedContents(files: Record<string, string>, includes: readonly string[]): Promise<string | undefined> {
  const temporaryDir = await mkdtemp(path.join(tmpdir(), 'mike-assist-backup-verify-'))
  const auditDir = path.join(temporaryDir, 'audit')
  try {
    await mkdir(auditDir)
    for (const [relPath, base64Data] of Object.entries(files)) {
      if (relPath.startsWith('audit/')) {
        await writeFile(path.join(auditDir, path.basename(relPath)), Buffer.from(base64Data, 'base64'), { flag: 'wx' })
      } else if (relPath.endsWith('.sqlite')) {
        await writeFile(path.join(temporaryDir, path.basename(relPath)), Buffer.from(base64Data, 'base64'), { flag: 'wx' })
      }
    }

    for (const name of includes) {
      if (!name.endsWith('.sqlite')) continue
      try {
        verifySqliteFile(path.join(temporaryDir, name))
      } catch {
        return `Backup database failed its SQLite integrity check: ${name}`
      }
    }

    const audit = new AuditLog(auditDir, 'backup-verify')
    await audit.init()
    if (!audit.getIntegrity().valid) return 'Backup audit log failed hash-chain integrity verification.'
    return undefined
  } catch {
    return 'Encrypted backup contents could not be validated.'
  } finally {
    await rm(temporaryDir, { recursive: true, force: true }).catch(() => undefined)
  }
}

function verifySqliteFile(file: string): void {
  const database = new DatabaseSync(file, { readOnly: true })
  try {
    const quickCheck = database.prepare('PRAGMA quick_check').all() as Array<Record<string, unknown>>
    const tables = database.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as Array<{ name: string }>
    const expectedTable = REQUIRED_DATABASE_TABLES[path.basename(file)]
    if (
      quickCheck.length !== 1 || Object.values(quickCheck[0] ?? {})[0] !== 'ok' ||
      !expectedTable || !tables.some((table) => table.name === expectedTable)
    ) {
      throw new Error('SQLite backup is invalid or missing its application tables.')
    }
  } finally {
    database.close()
  }
}

function isAllowedArchiveFile(relPath: string, includes: readonly string[]): boolean {
  if (BACKUP_ROOT_FILES.has(relPath)) return includes.includes(relPath)
  return includes.includes('audit/') && /^audit\/[A-Za-z0-9._-]{1,120}\.jsonl$/.test(relPath)
}

async function collectFilesRecursively(
  dir: string,
  rootDir: string,
  acc: Record<string, string> = {}
): Promise<Record<string, string>> {
  const entries = await readdir(dir, { withFileTypes: true })
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      await collectFilesRecursively(fullPath, rootDir, acc)
    } else if (entry.isFile()) {
      const rel = path.relative(rootDir, fullPath).split(path.sep).join('/')
      const bytes = await readFile(fullPath)
      acc[rel] = bytes.toString('base64')
    }
  }
  return acc
}

function encryptArchive(payload: ArchivePayload, passphrase: string): EncryptedArchiveEnvelope {
  const salt = randomBytes(16)
  const iv = randomBytes(12)
  const key = scryptSync(passphrase, salt, 32)
  const cipher = createCipheriv('aes-256-gcm', key, iv)
  const plaintext = Buffer.from(JSON.stringify(payload), 'utf8')
  const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final()])
  const tag = cipher.getAuthTag()
  return {
    salt: salt.toString('base64'),
    iv: iv.toString('base64'),
    tag: tag.toString('base64'),
    ciphertext: encrypted.toString('base64')
  }
}

function decryptArchive(envelope: EncryptedArchiveEnvelope, passphrase: string): ArchivePayload {
  const salt = Buffer.from(envelope.salt, 'base64')
  const iv = Buffer.from(envelope.iv, 'base64')
  const tag = Buffer.from(envelope.tag, 'base64')
  const ciphertext = Buffer.from(envelope.ciphertext, 'base64')
  const key = scryptSync(passphrase, salt, 32)
  const decipher = createDecipheriv('aes-256-gcm', key, iv)
  decipher.setAuthTag(tag)
  const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()])
  return JSON.parse(decrypted.toString('utf8')) as ArchivePayload
}
