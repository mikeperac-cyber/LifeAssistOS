import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'node:crypto'
import { copyFile, lstat, mkdir, mkdtemp, open, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { DatabaseSync } from 'node:sqlite'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { PlanningStore } from './planning'

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
const MAX_BACKUP_MANIFEST_BYTES = 64 * 1024
const MAX_BACKUP_SETTINGS_BYTES = 1024 * 1024
const MAX_BACKUP_DATABASE_BYTES = 64 * 1024 * 1024
// The archive JSON stores file contents as base64, then base64-encodes the
// encrypted payload. Account for both layers plus the small JSON envelope.
const MAX_ENCRYPTED_ARCHIVE_BYTES = Math.ceil((MAX_BACKUP_SETTINGS_BYTES + MAX_BACKUP_DATABASE_BYTES) * 16 / 9) + 128 * 1024

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
  if (isInside(source, target)) throw new Error('Choose a backup location outside the existing Mike Assist data folder.')
  const stage = `${target}.tmp-${randomBytes(8).toString('hex')}`
  const passphrase = options?.passphrase?.trim() ?? ''

  try {
    await mkdir(path.dirname(target), { recursive: true })
    await mkdir(stage)
    const settingsFile = path.resolve(options?.settingsFile ?? path.join(source, 'settings.json'))
    if (!isInside(source, settingsFile) || path.basename(settingsFile) !== 'settings.json') {
      throw new Error('The settings file must be inside the existing Mike Assist data folder.')
    }
    await copyRegularFile(settingsFile, path.join(stage, 'settings.json'))
    await planning.backupTo(path.join(stage, 'planning.sqlite'))
    await assertRegularFileSize(path.join(stage, 'settings.json'), MAX_BACKUP_SETTINGS_BYTES)
    await assertRegularFileSize(path.join(stage, 'planning.sqlite'), MAX_BACKUP_DATABASE_BYTES)

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
    const value: unknown = JSON.parse(await readBoundedFile(path.join(source, 'manifest.json'), MAX_BACKUP_MANIFEST_BYTES))
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
      const envelope = JSON.parse(await readBoundedFile(path.join(source, 'archive.enc'), MAX_ENCRYPTED_ARCHIVE_BYTES)) as EncryptedEnvelope
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
      if (name === 'settings.json') await assertRegularFileSize(item, MAX_BACKUP_SETTINGS_BYTES)
      if (name === 'planning.sqlite') await assertRegularFileSize(item, MAX_BACKUP_DATABASE_BYTES)
    }
    const settingsError = await verifySettingsFile(path.join(source, 'settings.json'))
    if (settingsError) return { valid: false, ...metadata, error: settingsError }
    if (manifest.includes.includes('planning.sqlite')) await verifySqliteFile(path.join(source, 'planning.sqlite'))
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
  if (isInside(destination, source)) throw new Error('Cannot restore from a folder inside the existing Mike Assist data folder.')
  const verification = await verifyBackupSnapshot(source, { passphrase: options?.passphrase })
  if (!verification.valid || !verification.includes) throw new Error(verification.error ?? 'Backup verification failed.')
  const files = await readRestorableFiles(source, verification, options?.passphrase)
  await verifyRestorableFiles(files)

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
          'The restore failed and automatic rollback could not finish. LifeAssistOS must restart to recover the previous data.',
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
          'LifeAssistOS could not reopen its stores after restore. The app must restart to reload its data.',
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
      await verifySqliteFile(path.join(directory, 'planning.sqlite'))
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') return 'Backup database failed its SQLite integrity check: planning.sqlite'
    }
    return undefined
  } catch { return 'Encrypted backup contents could not be validated.' }
  finally { await rm(directory, { recursive: true, force: true }).catch(() => undefined) }
}

/** Revalidates the exact buffers that will be written, closing the gap between
 * checking a selected backup path and later reopening it for restore. */
async function verifyRestorableFiles(files: Record<string, Buffer>): Promise<void> {
  const settings = files['settings.json']
  if (!settings || settings.byteLength > MAX_BACKUP_SETTINGS_BYTES) {
    throw new Error('Backup settings file is missing or exceeds the supported size limit.')
  }
  try {
    const value: unknown = JSON.parse(settings.toString('utf8'))
    if (!isRecord(value) || !isRecord(value.provider)) throw new Error('invalid settings')
  } catch {
    throw new Error('Backup settings file is missing or invalid.')
  }

  const databaseBytes = files['planning.sqlite']
  if (!databaseBytes) return
  if (databaseBytes.byteLength > MAX_BACKUP_DATABASE_BYTES) {
    throw new Error('Backup database exceeds the supported size limit: planning.sqlite')
  }
  await verifySqliteBuffer(databaseBytes)
}

async function verifySettingsFile(file: string): Promise<string | undefined> {
  try {
    const value: unknown = JSON.parse(await readBoundedFile(file, MAX_BACKUP_SETTINGS_BYTES))
    return isRecord(value) && isRecord(value.provider) ? undefined : 'Backup settings file is invalid.'
  } catch { return 'Backup settings file is missing or invalid.' }
}

async function verifySqliteFile(file: string): Promise<void> {
  const info = await lstat(file)
  if (!info.isFile() || info.isSymbolicLink() || info.size > MAX_BACKUP_DATABASE_BYTES) {
    throw new Error('Backup database exceeds the supported size limit: planning.sqlite')
  }
  await verifySqliteBuffer(await readBoundedBuffer(file, MAX_BACKUP_DATABASE_BYTES))
}

async function verifySqliteBuffer(bytes: Buffer): Promise<void> {
  if (bytes.byteLength > MAX_BACKUP_DATABASE_BYTES) {
    throw new Error('Backup database exceeds the supported size limit: planning.sqlite')
  }
  const directory = await mkdtemp(path.join(tmpdir(), 'mike-assist-backup-schema-'))
  const file = path.join(directory, 'planning.sqlite')
  try {
    await writeFile(file, bytes, { flag: 'wx', mode: 0o600 })
    const database = new DatabaseSync(file, { readOnly: true })
    try {
    assertSafeBackupSchema(database)
    const check = database.prepare('PRAGMA quick_check').all() as Array<Record<string, unknown>>
    const tables = database.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as Array<{ name: string }>
    if (check.length !== 1 || Object.values(check[0] ?? {})[0] !== 'ok' || !tables.some((table) => table.name === 'tasks')) {
      throw new Error('Backup database failed its SQLite integrity check: planning.sqlite')
    }
    } finally { database.close() }

    const store = new PlanningStore(file)
    try {
      await store.init()
      store.snapshot('2000-01-01')
      store.listTasks(true)
      store.listMyDay('2000-01-01')
      store.listAssistantTasks()
      store.listDueReminders('2100-01-01T00:00:00.000Z')
      store.projectWorkspace()
      // Exercise the current schema's write paths on this disposable database.
      // PlanningStore.init() can add tables and selected migrations, but it does
      // not prove that imported tables contain every column used by mutations.
      const area = store.createArea({ name: 'Restore validation', icon: 'briefcase', color: 'teal' })
      const project = store.createProject({ name: 'Restore validation', areaId: area.id })
      const task = store.addTask({ title: 'Restore validation', projectId: project.id })
      store.updateTask(task.id, { title: 'Restore validation updated' })
      const inboxItem = store.capture('Restore validation')
      store.convertInbox(inboxItem.id)
      store.dismissInbox(store.capture('Restore validation dismissed').id)
      const dueDate = new Date(Date.now() - new Date().getTimezoneOffset() * 60_000).toISOString().slice(0, 10)
      const recurring = store.addTask({ title: 'Restore recurring task', dueDate, recurrenceRule: { frequency: 'daily' } })
      store.updateTask(recurring.id, { status: 'done' })
      if (!store.listTasks(true).some((task) => task.recurrenceSeriesId === recurring.recurrenceSeriesId && task.status === 'open')) {
        throw new Error('Recurring task did not advance.')
      }
    } catch {
      throw new Error('Backup database is incompatible with LifeAssistOS.')
    } finally {
      store.close()
    }
  } finally {
    await rm(directory, { recursive: true, force: true }).catch(() => undefined)
  }
}

const SAFE_BACKUP_CHECK_EXPRESSIONS = new Set([
  "priorityin('low','normal','high')",
  "statusin('open','done','cancelled')",
  "iconin('briefcase','home','book','leaf')",
  "colorin('teal','blue','amber','violet')",
  "source_email_providerisnullorsource_email_providerin('gmail','outlook')",
  "source_calendar_providerisnullorsource_calendar_providerin('google_calendar','microsoft_calendar')",
  "source_task_providerisnullorsource_task_providerin('google_tasks','microsoft_todo')",
  "providerin('google_tasks','microsoft_todo')",
  "statusin('sending','sent','failed','uncertain')",
  "sync_statusin('idle','sending','failed','uncertain')",
  "synced_priorityisnullorsynced_priorityin('low','normal','high')"
])
const SAFE_BACKUP_DEFAULTS = new Set(["'next'", "'normal'", "'open'", "'idle'", "''", '0'])
const SAFE_PARTIAL_INDEX_SQL = 'create unique index tasks_recurrence_series_date on tasks(recurrence_series_id, recurrence_date) where recurrence_series_id is not null'

/** Reject schema features that can execute expressions while checking or mutating an imported database. */
function assertSafeBackupSchema(database: DatabaseSync): void {
  const objects = database.prepare(
    'SELECT type, name, tbl_name, sql FROM sqlite_schema WHERE sql IS NOT NULL'
  ).all() as Array<{ type: string; name: string; tbl_name: string; sql: string }>

  if (objects.some(({ type }) => type === 'trigger')) {
    throw new Error('Backup database contains an unsupported SQLite trigger: planning.sqlite')
  }
  if (objects.some(({ type }) => type === 'view')) {
    throw new Error('Backup database contains an unsupported SQLite view: planning.sqlite')
  }

  for (const object of objects) {
    if (object.type === 'table') {
      if (/\bCREATE\s+VIRTUAL\s+TABLE\b/i.test(object.sql)) {
        throw new Error('Backup database contains an unsupported SQLite virtual table: planning.sqlite')
      }
      if (extractCheckExpressions(object.sql).some((expression) => !SAFE_BACKUP_CHECK_EXPRESSIONS.has(expression))) {
        throw new Error('Backup database contains an unsupported SQLite check expression: planning.sqlite')
      }
      const columns = database.prepare(`PRAGMA table_xinfo(${quoteSqlIdentifier(object.name)})`).all() as Array<{
        hidden?: number
        dflt_value: string | null
      }>
      if (columns.some(({ hidden }) => hidden !== undefined && hidden !== 0)) {
        throw new Error('Backup database contains an unsupported generated column: planning.sqlite')
      }
      if (columns.some(({ dflt_value }) => dflt_value !== null && !SAFE_BACKUP_DEFAULTS.has(dflt_value))) {
        throw new Error('Backup database contains an unsupported SQLite default expression: planning.sqlite')
      }
    }

    if (object.type === 'index') {
      const columns = database.prepare(`PRAGMA index_xinfo(${quoteSqlIdentifier(object.name)})`).all() as Array<{ cid: number }>
      if (columns.some(({ cid }) => cid === -2)) {
        throw new Error('Backup database contains an unsupported SQLite expression index: planning.sqlite')
      }
      const indexes = database.prepare(`PRAGMA index_list(${quoteSqlIdentifier(object.tbl_name)})`).all() as Array<{
        name: string
        partial: number
      }>
      const index = indexes.find(({ name }) => name === object.name)
      if (index?.partial && object.sql.replace(/\s+/g, ' ').trim().toLowerCase() !== SAFE_PARTIAL_INDEX_SQL) {
        throw new Error('Backup database contains an unsupported SQLite partial index: planning.sqlite')
      }
    }

    if (object.type === 'table' && hasConflictPolicy(object.sql)) {
      throw new Error('Backup database contains an unsupported SQLite conflict policy: planning.sqlite')
    }
  }
}

function extractCheckExpressions(sql: string): string[] {
  const expressions: string[] = []
  let index = 0
  while (index < sql.length) {
    const character = sql[index]!
    if (character === '-' && sql[index + 1] === '-') {
      index = skipSqlLineComment(sql, index)
      continue
    }
    if (character === '/' && sql[index + 1] === '*') {
      index = skipSqlBlockComment(sql, index)
      continue
    }
    if (character === "'" || character === '"' || character === '`' || character === '[') {
      index = skipSqlQuotedValue(sql, index)
      continue
    }
    if (!/[A-Za-z_]/.test(character)) {
      index++
      continue
    }

    const start = index++
    while (index < sql.length && /[A-Za-z0-9_$]/.test(sql[index]!)) index++
    if (sql.slice(start, index).toLowerCase() !== 'check') continue
    index = skipSqlTrivia(sql, index)
    if (sql[index] !== '(') continue

    const expressionStart = ++index
    let depth = 1
    while (index < sql.length && depth > 0) {
      const current = sql[index]!
      if (current === '-' && sql[index + 1] === '-') {
        index = skipSqlLineComment(sql, index)
        continue
      }
      if (current === '/' && sql[index + 1] === '*') {
        index = skipSqlBlockComment(sql, index)
        continue
      }
      if (current === "'" || current === '"' || current === '`' || current === '[') {
        index = skipSqlQuotedValue(sql, index)
        continue
      }
      if (current === '(') depth++
      else if (current === ')') depth--
      index++
    }
    if (depth !== 0) return ['<invalid>']
    expressions.push(sql.slice(expressionStart, index - 1).replace(/\s+/g, '').toLowerCase())
  }
  return expressions
}

function skipSqlTrivia(sql: string, from: number): number {
  let index = from
  while (index < sql.length) {
    if (/\s/.test(sql[index]!)) { index++; continue }
    if (sql[index] === '-' && sql[index + 1] === '-') { index = skipSqlLineComment(sql, index); continue }
    if (sql[index] === '/' && sql[index + 1] === '*') { index = skipSqlBlockComment(sql, index); continue }
    break
  }
  return index
}

function skipSqlLineComment(sql: string, from: number): number {
  let index = from + 2
  while (index < sql.length && sql[index] !== '\n' && sql[index] !== '\r') index++
  return index
}

function skipSqlBlockComment(sql: string, from: number): number {
  const end = sql.indexOf('*/', from + 2)
  return end < 0 ? sql.length : end + 2
}

function skipSqlQuotedValue(sql: string, from: number): number {
  const opening = sql[from]!
  const closing = opening === '[' ? ']' : opening
  let index = from + 1
  while (index < sql.length) {
    if (sql[index] !== closing) { index++; continue }
    if (opening !== '[' && sql[index + 1] === closing) { index += 2; continue }
    return index + 1
  }
  return sql.length
}

function quoteSqlIdentifier(identifier: string): string {
  return `"${identifier.replace(/"/g, '""')}"`
}

function hasConflictPolicy(sql: string): boolean {
  let index = 0
  let onKeyword = false
  while (index < sql.length) {
    const current = sql[index]!
    const next = sql[index + 1]

    if (/\s/.test(current)) {
      index++
      continue
    }
    if (current === '-' && next === '-') {
      while (index < sql.length && sql[index] !== '\n' && sql[index] !== '\r') index++
      continue
    }
    if (current === '/' && next === '*') {
      index += 2
      while (index < sql.length) {
        if (sql[index] === '*' && sql[index + 1] === '/') {
          index += 2
          break
        }
        index++
      }
      continue
    }

    const closing = current === '[' ? ']' : current
    if (current === "'" || current === '"' || current === '`' || current === '[') {
      onKeyword = false
      index++
      while (index < sql.length) {
        const character = sql[index]!
        index++
        if (character !== closing) continue
        if (sql[index] === closing) {
          index++
          continue
        }
        break
      }
      continue
    }

    if (isSqlIdentifierCharacter(current)) {
      const start = index
      while (index < sql.length && isSqlIdentifierCharacter(sql[index]!)) index++
      const length = index - start
      const isConflict = length === 8 && sql.slice(start, index).toUpperCase() === 'CONFLICT'
      if (onKeyword && isConflict) return true
      onKeyword = length === 2 && sql.slice(start, index).toUpperCase() === 'ON'
      continue
    }

    onKeyword = false
    index++
  }
  return false
}

function isSqlIdentifierCharacter(character: string): boolean {
  const code = character.charCodeAt(0)
  return code > 0x7f ||
    (code >= 0x30 && code <= 0x39) ||
    (code >= 0x41 && code <= 0x5a) ||
    (code >= 0x61 && code <= 0x7a) ||
    character === '_' || character === '$'
}

async function readRestorableFiles(source: string, verification: BackupVerification, passphrase?: string): Promise<Record<string, Buffer>> {
  const files: Record<string, Buffer> = {}
  if (verification.encrypted) {
    const envelope = JSON.parse(await readBoundedFile(path.join(source, 'archive.enc'), MAX_ENCRYPTED_ARCHIVE_BYTES)) as EncryptedEnvelope
    const payload = decryptArchive(envelope, passphrase?.trim() ?? '')
    const manifest = JSON.parse(await readBoundedFile(path.join(source, 'manifest.json'), MAX_BACKUP_MANIFEST_BYTES)) as BackupManifest
    validateArchiveFiles(payload, manifest)
    for (const [name, encoded] of Object.entries(payload.files)) {
      const limit = name === 'settings.json' ? MAX_BACKUP_SETTINGS_BYTES : MAX_BACKUP_DATABASE_BYTES
      if (Buffer.byteLength(encoded, 'base64') > limit) throw new Error('Backup archive contains an oversized file.')
    }
    for (const name of TASK_FILES) if (payload.files[name] !== undefined) files[name] = Buffer.from(payload.files[name]!, 'base64')
  } else {
    for (const name of TASK_FILES) {
      if (!verification.includes?.includes(name)) continue
      const limit = name === 'settings.json' ? MAX_BACKUP_SETTINGS_BYTES : MAX_BACKUP_DATABASE_BYTES
      files[name] = await readBoundedBuffer(path.join(source, name), limit)
    }
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

async function assertRegularFileSize(file: string, maxBytes: number): Promise<void> {
  const info = await lstat(file)
  if (!info.isFile() || info.isSymbolicLink()) throw new Error('Backup entry must be a regular file.')
  if (info.size > maxBytes) throw new Error('Backup file exceeds the supported size limit.')
}

async function readBoundedFile(file: string, maxBytes: number): Promise<string> {
  return (await readBoundedBuffer(file, maxBytes)).toString('utf8')
}

async function readBoundedBuffer(file: string, maxBytes: number): Promise<Buffer> {
  const handle = await open(file, 'r')
  try {
    const info = await handle.stat()
    if (!info.isFile() || info.size > maxBytes) throw new Error('Backup file exceeds the supported size limit.')
    const chunks: Buffer[] = []
    let total = 0
    for (;;) {
      const buffer = Buffer.allocUnsafe(Math.min(64 * 1024, maxBytes + 1 - total))
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, null)
      if (bytesRead === 0) break
      total += bytesRead
      if (total > maxBytes) throw new Error('Backup file exceeds the supported size limit.')
      chunks.push(buffer.subarray(0, bytesRead))
    }
    return Buffer.concat(chunks, total)
  } finally {
    await handle.close()
  }
}
function isInside(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate)
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative))
}
