import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'node:crypto'
import { access, copyFile, cp, mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises'
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
  'scheduled-tasks.json'
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
    manifest = JSON.parse(raw) as BackupManifest
  } catch {
    return { valid: false, encrypted: false, error: 'Missing or invalid manifest.json in backup folder.' }
  }

  if (manifest.formatVersion !== 1 || !isValidManifestIncludes(manifest.includes)) {
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
        if (!isAllowedArchiveFile(relPath, manifest.includes) || typeof base64Data !== 'string') {
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
      await access(checkPath)
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

  await options?.closeStores?.()
  await mkdir(destination, { recursive: true })

  const restoredFiles: string[] = []
  try {
    if (verification.encrypted) {
      const rawEnvelope = await readFile(path.join(source, 'archive.enc'), 'utf8')
      const envelope = JSON.parse(rawEnvelope) as EncryptedArchiveEnvelope
      const payload = decryptArchive(envelope, options!.passphrase!.trim())
      const archiveEntries = Object.entries(payload.files)
      if (archiveEntries.some(([relPath, base64Data]) =>
        !isAllowedArchiveFile(relPath, verification.includes!) || typeof base64Data !== 'string'
      )) {
        throw new Error('Encrypted backup contains an unsafe or unexpected entry.')
      }
      await rm(path.join(destination, 'audit'), { recursive: true, force: true }).catch(() => undefined)
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
          await cp(path.join(source, 'audit'), path.join(destination, 'audit'), { recursive: true })
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
  } finally {
    await options?.reopenStores?.()
  }

  return { restoredFiles }
}

function isValidManifestIncludes(value: unknown): value is string[] {
  return (
    Array.isArray(value) &&
    value.every((entry) => entry === 'audit/' || (typeof entry === 'string' && BACKUP_ROOT_FILES.has(entry))) &&
    new Set(value).size === value.length &&
    REQUIRED_BACKUP_ENTRIES.every((entry) => value.includes(entry))
  )
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
