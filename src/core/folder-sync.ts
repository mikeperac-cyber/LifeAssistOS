import { createCipheriv, createDecipheriv, randomBytes, randomUUID, scryptSync } from 'node:crypto'
import { mkdir, open, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises'
import { DatabaseSync } from 'node:sqlite'
import path from 'node:path'

const TABLES = ['task_areas', 'life_goals', 'task_projects', 'tasks', 'inbox', 'routine_templates', 'journal_entries', 'calendar_sources', 'calendar_events', 'personal_context'] as const
type SyncTable = typeof TABLES[number]
type SyncRow = Record<string, string | number | null> & { syncUpdatedAt: string }
interface Tombstone { table: SyncTable; id: string; deletedAt: string; deviceId: string }
interface Snapshot { version: 1; deviceId: string; updatedAt: string; tables: Record<SyncTable, SyncRow[]>; tombstones: Tombstone[] }
interface Envelope { format: 'mike-assist-encrypted-sync'; version: 1; salt: string; iv: string; tag: string; ciphertext: string }
export interface FolderSyncConfig { folderPath: string | null; deviceId: string; encryptedPassphrase?: string }

const MAX_FILE_BYTES = 32 * 1024 * 1024
const MAX_ROWS = 100_000
const MAX_SYNC_DEVICES = 12
const MAX_TOTAL_SNAPSHOT_ROWS = 300_000
const AAD = Buffer.from('mike-assist-folder-sync-v1')

/** Merge encrypted per-device snapshots from a user-selected cloud-synced folder. */
export async function syncSharedFolder(database: DatabaseSync, folder: string, deviceId: string, passphrase: string): Promise<{ peerCount: number; recordCount: number; syncedAt: string; changed: boolean }> {
  if (typeof passphrase !== 'string' || passphrase.length < 12 || passphrase.length > 1024) throw new Error('Use a sync passphrase with at least 12 characters.')
  await mkdir(folder, { recursive: true })
  const ownPath = path.join(folder, `mike-assist-${deviceId}.sync`)
  const entries = await readdir(folder, { withFileTypes: true })
  const snapshots: Snapshot[] = []
  let totalSnapshotBytes = 0
  let totalSnapshotRows = 0
  for (const entry of entries) {
    const match = /^mike-assist-([0-9a-f-]{36})\.sync$/i.exec(entry.name)
    if (!match || !entry.isFile()) continue
    if (snapshots.length >= MAX_SYNC_DEVICES) throw new Error(`This shared folder has more than ${MAX_SYNC_DEVICES} device snapshots.`)
    const filePath = path.join(folder, entry.name)
    const fileStat = await stat(filePath)
    if (fileStat.size > MAX_FILE_BYTES) throw new Error(`Sync snapshot ${entry.name} exceeds the supported size limit.`)
    totalSnapshotBytes += fileStat.size
    if (totalSnapshotBytes > MAX_SYNC_DEVICES * MAX_FILE_BYTES) throw new Error('The shared sync folder contains too much data to process safely.')
    const contents = await readFile(filePath)
    if (contents.byteLength > MAX_FILE_BYTES) throw new Error(`Sync snapshot ${entry.name} exceeds the supported size limit.`)
    const envelope = parseEnvelope(JSON.parse(contents.toString('utf8')))
    const snapshot = validateSnapshot(decrypt(envelope, passphrase), match[1]!.toLowerCase())
    totalSnapshotRows += TABLES.reduce((count, table) => count + snapshot.tables[table].length, snapshot.tombstones.length)
    if (totalSnapshotRows > MAX_TOTAL_SNAPSHOT_ROWS) throw new Error('The shared sync folder contains too many workspace records.')
    snapshots.push(snapshot)
  }

  // Capture local data only after network-folder reads finish. The merge and
  // SQLite transaction below are synchronous, so renderer writes cannot race it.
  const localTables = readTables(database)
  const previousOwn = snapshots.find((snapshot) => snapshot.deviceId === deviceId)
  const now = new Date().toISOString()
  const tombstones = new Map<string, Tombstone>()
  for (const snapshot of snapshots) {
    for (const tombstone of snapshot.tombstones) chooseTombstone(tombstones, tombstone)
  }
  if (previousOwn) {
    for (const table of TABLES) {
      const currentIds = new Set(localTables[table].map((row) => recordId(table, row)))
      for (const oldRow of previousOwn.tables[table]) {
        const id = String(oldRow.id ?? oldRow.key ?? '')
        if (id && !currentIds.has(id)) chooseTombstone(tombstones, { table, id, deletedAt: now, deviceId })
      }
    }
  }

  const winnerRows = new Map<string, { row: SyncRow; deviceId: string }>()
  for (const table of TABLES) {
    for (const row of localTables[table]) chooseRow(winnerRows, table, row, deviceId)
  }
  for (const snapshot of snapshots) {
    for (const table of TABLES) for (const row of snapshot.tables[table]) chooseRow(winnerRows, table, row, snapshot.deviceId)
  }
  const merged: Record<SyncTable, SyncRow[]> = Object.fromEntries(TABLES.map((table) => [table, []])) as unknown as Record<SyncTable, SyncRow[]>
  for (const [key, winner] of winnerRows) {
    const tombstone = tombstones.get(key)
    if (!tombstone || compareVersion(winner.row.syncUpdatedAt, winner.deviceId, tombstone.deletedAt, tombstone.deviceId) > 0) {
      const table = key.slice(0, key.indexOf(':')) as SyncTable
      merged[table].push(winner.row)
    }
  }
  dedupeRecurringOccurrences(merged, tombstones, deviceId, now)
  normalizeReferences(merged, now)
  for (const table of TABLES) merged[table].sort((a, b) => recordId(table, a).localeCompare(recordId(table, b)))
  const changed = !sameTables(localTables, merged)
  if (changed) applyTables(database, merged)

  const snapshot: Snapshot = { version: 1, deviceId, updatedAt: now, tables: merged, tombstones: [...tombstones.values()] }
  const shouldPublish = !previousOwn || !sameTables(previousOwn.tables, merged) || !sameTombstones(previousOwn.tombstones, snapshot.tombstones)
  if (shouldPublish) {
    const encrypted = encrypt(snapshot, passphrase)
    const bytes = Buffer.from(JSON.stringify(encrypted), 'utf8')
    if (bytes.length > MAX_FILE_BYTES) throw new Error('The encrypted sync snapshot exceeds the supported size limit.')
    const temporaryPath = `${ownPath}.${randomUUID()}.tmp`
    const file = await open(temporaryPath, 'wx', 0o600)
    try { await file.writeFile(bytes); await file.sync() } finally { await file.close() }
    try { await rename(temporaryPath, ownPath) } catch (error) { await rm(temporaryPath, { force: true }); throw error }
  }
  return { peerCount: new Set(snapshots.map((snapshot) => snapshot.deviceId).filter((id) => id !== deviceId)).size, recordCount: TABLES.reduce((count, table) => count + merged[table].length, 0), syncedAt: now, changed }
}

export function createSyncDeviceId(): string { return randomUUID() }

export async function readFolderSyncConfig(userDataDir: string): Promise<FolderSyncConfig> {
  const configPath = path.join(userDataDir, 'folder-sync.json')
  try {
    const value: unknown = JSON.parse(await readFile(configPath, 'utf8'))
    if (!isRecord(value) || typeof value['deviceId'] !== 'string' || !/^[0-9a-f-]{36}$/i.test(value['deviceId']) || (value['folderPath'] !== null && (typeof value['folderPath'] !== 'string' || !path.isAbsolute(value['folderPath']))) || (value['encryptedPassphrase'] !== undefined && !isBase64(value['encryptedPassphrase']))) throw new Error('invalid config')
    return { deviceId: value['deviceId'], folderPath: value['folderPath'] as string | null, ...(typeof value['encryptedPassphrase'] === 'string' ? { encryptedPassphrase: value['encryptedPassphrase'] } : {}) }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw new Error('Folder sync settings could not be read. Check the app data folder.')
    const config = { deviceId: createSyncDeviceId(), folderPath: null }
    await writeFolderSyncConfig(userDataDir, config)
    return config
  }
}

export async function writeFolderSyncConfig(userDataDir: string, config: FolderSyncConfig): Promise<void> {
  if (!/^[0-9a-f-]{36}$/i.test(config.deviceId) || (config.folderPath !== null && (!path.isAbsolute(config.folderPath) || config.folderPath.length > 2048)) || (config.encryptedPassphrase !== undefined && !isBase64(config.encryptedPassphrase))) throw new Error('Choose a valid sync folder.')
  await mkdir(userDataDir, { recursive: true })
  const target = path.join(userDataDir, 'folder-sync.json')
  const temporary = `${target}.${randomUUID()}.tmp`
  await writeFile(temporary, JSON.stringify({ version: 1, ...config }), { flag: 'wx', mode: 0o600 })
  try { await rename(temporary, target) } catch (error) { await rm(temporary, { force: true }); throw error }
}

function readTables(database: DatabaseSync): Record<SyncTable, SyncRow[]> {
  const result = Object.fromEntries(TABLES.map((table) => [table, []])) as unknown as Record<SyncTable, SyncRow[]>
  const sourceVersions = new Map((database.prepare('SELECT id, imported_at FROM calendar_sources').all() as Array<{ id: string; imported_at: string }>).map((row) => [row.id, row.imported_at]))
  let total = 0
  for (const table of TABLES) {
    const rows = table === 'calendar_events'
      ? database.prepare('SELECT * FROM calendar_events').all() as Array<Record<string, string | number | null>>
      : database.prepare(`SELECT * FROM ${table}`).all() as Array<Record<string, string | number | null>>
    for (const row of rows) {
      total += 1
      if (total > MAX_ROWS) throw new Error('This workspace has too many records to sync in one snapshot.')
      result[table].push({ ...row, syncUpdatedAt: rowVersion(table, row, sourceVersions) })
    }
  }
  return result
}

function rowVersion(table: SyncTable, row: Record<string, string | number | null>, sources: Map<string, string>): string {
  const value = table === 'calendar_events' ? sources.get(String(row['source_id']))
    : table === 'calendar_sources' ? row['imported_at']
      : table === 'task_areas' ? row['created_at']
        : table === 'inbox' ? row['updated_at'] ?? row['created_at']
          : table === 'personal_context' ? row['updated_at']
            : row['updated_at'] ?? row['created_at']
  return typeof value === 'string' && Number.isFinite(Date.parse(value)) ? value : '1970-01-01T00:00:00.000Z'
}

function applyTables(database: DatabaseSync, tables: Record<SyncTable, SyncRow[]>): void {
  const columns = new Map<SyncTable, string[]>()
  for (const table of TABLES) columns.set(table, (database.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>).map((row) => row.name))
  database.exec('BEGIN IMMEDIATE')
  try {
    for (const table of [...TABLES].reverse()) database.prepare(`DELETE FROM ${table}`).run()
    let total = 0
    for (const table of TABLES) {
      for (const row of tables[table]) {
        total += 1
        if (total > MAX_ROWS) throw new Error('This workspace has too many records to sync in one snapshot.')
        const tableColumns = columns.get(table)!
        const selected = tableColumns.filter((column) => Object.hasOwn(row, column))
        if (!selected.includes(table === 'personal_context' ? 'key' : 'id')) throw new Error(`A sync record in ${table} is missing its identity.`)
        const quotedColumns = selected.map((column) => `"${column.replace(/"/g, '""')}"`).join(', ')
        const placeholders = selected.map(() => '?').join(', ')
        database.prepare(`INSERT INTO ${table} (${quotedColumns}) VALUES (${placeholders})`).run(...selected.map((column) => row[column] ?? null))
      }
    }
    database.exec('COMMIT')
  } catch (error) {
    try { database.exec('ROLLBACK') } catch { /* Keep the original error. */ }
    throw error
  }
}

function chooseRow(winners: Map<string, { row: SyncRow; deviceId: string }>, table: SyncTable, row: SyncRow, deviceId: string): void {
  const key = `${table}:${recordId(table, row)}`
  const current = winners.get(key)
  if (!current || compareVersion(row.syncUpdatedAt, deviceId, current.row.syncUpdatedAt, current.deviceId) > 0) winners.set(key, { row, deviceId })
}

function chooseTombstone(tombstones: Map<string, Tombstone>, value: Tombstone): void {
  const key = `${value.table}:${value.id}`
  const current = tombstones.get(key)
  if (!current || compareVersion(value.deletedAt, value.deviceId, current.deletedAt, current.deviceId) > 0) tombstones.set(key, value)
}

function compareVersion(leftAt: string, leftDevice: string, rightAt: string, rightDevice: string): number {
  return leftAt.localeCompare(rightAt) || leftDevice.localeCompare(rightDevice)
}

function recordId(table: SyncTable, row: Record<string, unknown>): string {
  return String(table === 'personal_context' ? row['key'] ?? '' : row['id'] ?? '')
}

function sameTables(left: Record<SyncTable, SyncRow[]>, right: Record<SyncTable, SyncRow[]>): boolean {
  return TABLES.every((table) => stableRows(table, left[table]) === stableRows(table, right[table]))
}

function stableRows(table: SyncTable, rows: SyncRow[]): string {
  return JSON.stringify(rows.map((row) => Object.fromEntries(Object.keys(row).sort().map((key) => [key, row[key]]))).sort((a, b) => recordId(table, a).localeCompare(recordId(table, b))))
}

function sameTombstones(left: Tombstone[], right: Tombstone[]): boolean {
  const stable = (items: Tombstone[]): string => JSON.stringify(items.map((item) => ({ ...item })).sort((a, b) => `${a.table}:${a.id}`.localeCompare(`${b.table}:${b.id}`)))
  return stable(left) === stable(right)
}

function normalizeReferences(tables: Record<SyncTable, SyncRow[]>, now: string): void {
  const ids = (table: SyncTable): Set<string> => new Set(tables[table].map((row) => recordId(table, row)))
  const areas = ids('task_areas'); const goals = ids('life_goals'); const projects = ids('task_projects'); const tasks = ids('tasks'); const sources = ids('calendar_sources')
  const unlink = (row: SyncRow, field: string): void => {
    if (row[field] !== null) { row[field] = null; row['syncUpdatedAt'] = now; if ('updated_at' in row) row['updated_at'] = now }
  }
  for (const row of tables['life_goals']) if (row['area_id'] && !areas.has(String(row['area_id']))) unlink(row, 'area_id')
  for (const row of tables['task_projects']) {
    if (row['area_id'] && !areas.has(String(row['area_id']))) unlink(row, 'area_id')
    if (row['goal_id'] && !goals.has(String(row['goal_id']))) unlink(row, 'goal_id')
  }
  for (const row of tables['tasks']) {
    if (row['project_id'] && !projects.has(String(row['project_id']))) { unlink(row, 'project_id'); row['workflow_stage'] = 'next' }
    if (row['parent_task_id'] && !tasks.has(String(row['parent_task_id']))) unlink(row, 'parent_task_id')
  }
  for (const row of tables['routine_templates']) {
    if (row['area_id'] && !areas.has(String(row['area_id']))) unlink(row, 'area_id')
    if (row['project_id'] && !projects.has(String(row['project_id']))) unlink(row, 'project_id')
  }
  for (const row of tables['journal_entries']) {
    if (row['area_id'] && !areas.has(String(row['area_id']))) unlink(row, 'area_id')
    if (row['goal_id'] && !goals.has(String(row['goal_id']))) unlink(row, 'goal_id')
  }
  tables['calendar_events'] = tables['calendar_events'].filter((row) => sources.has(String(row['source_id'])))
}

function dedupeRecurringOccurrences(tables: Record<SyncTable, SyncRow[]>, tombstones: Map<string, Tombstone>, deviceId: string, now: string): void {
  const winners = new Map<string, SyncRow>()
  const duplicates: SyncRow[] = []
  for (const task of tables['tasks']) {
    if (typeof task['recurrence_series_id'] !== 'string' || typeof task['recurrence_date'] !== 'string') continue
    const key = `${task['recurrence_series_id']}:${task['recurrence_date']}`
    const current = winners.get(key)
    if (!current) { winners.set(key, task); continue }
    const comparison = compareVersion(task.syncUpdatedAt, String(task['id']), current.syncUpdatedAt, String(current['id']))
    if (comparison > 0) { duplicates.push(current); winners.set(key, task) }
    else duplicates.push(task)
  }
  if (!duplicates.length) return
  const timestamp = Math.max(Date.parse(now), ...tables['tasks'].map((task) => Date.parse(task.syncUpdatedAt))) + 1
  const deletedAt = new Date(timestamp).toISOString()
  const duplicateIds = new Set(duplicates.map((task) => String(task['id'])))
  tables['tasks'] = tables['tasks'].filter((task) => !duplicateIds.has(String(task['id'])))
  for (const task of duplicates) chooseTombstone(tombstones, { table: 'tasks', id: String(task['id']), deletedAt, deviceId })
}

function encrypt(snapshot: Snapshot, passphrase: string): Envelope {
  const salt = randomBytes(16)
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', scryptSync(passphrase, salt, 32, { N: 1 << 15, maxmem: 64 * 1024 * 1024 }), iv)
  cipher.setAAD(AAD)
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(snapshot)), cipher.final()])
  return { format: 'mike-assist-encrypted-sync', version: 1, salt: salt.toString('base64'), iv: iv.toString('base64'), tag: cipher.getAuthTag().toString('base64'), ciphertext: ciphertext.toString('base64') }
}

function decrypt(envelope: Envelope, passphrase: string): unknown {
  try {
    const salt = Buffer.from(envelope.salt, 'base64')
    const iv = Buffer.from(envelope.iv, 'base64')
    const tag = Buffer.from(envelope.tag, 'base64')
    const ciphertext = Buffer.from(envelope.ciphertext, 'base64')
    if (salt.length !== 16 || iv.length !== 12 || tag.length !== 16 || ciphertext.length > MAX_FILE_BYTES) throw new Error('invalid envelope')
    const decipher = createDecipheriv('aes-256-gcm', scryptSync(passphrase, salt, 32, { N: 1 << 15, maxmem: 64 * 1024 * 1024 }), iv)
    decipher.setAAD(AAD); decipher.setAuthTag(tag)
    return JSON.parse(Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8'))
  } catch { throw new Error('A synced device file could not be decrypted. Check that all devices use the same passphrase.') }
}

function parseEnvelope(value: unknown): Envelope {
  if (!isRecord(value) || value['format'] !== 'mike-assist-encrypted-sync' || value['version'] !== 1 ||
    !isBase64(value['salt']) || !isBase64(value['iv']) || !isBase64(value['tag']) || !isBase64(value['ciphertext'])) {
    throw new Error('The sync folder contains an unsupported or invalid Mike Assist file.')
  }
  return value as unknown as Envelope
}

function validateSnapshot(value: unknown, expectedDeviceId: string): Snapshot {
  if (!isRecord(value) || value['version'] !== 1 || value['deviceId'] !== expectedDeviceId || typeof value['updatedAt'] !== 'string' || !Number.isFinite(Date.parse(value['updatedAt'])) || !isRecord(value['tables']) || !Array.isArray(value['tombstones'])) throw new Error('A synced device file has an invalid workspace snapshot.')
  const tables = {} as Record<SyncTable, SyncRow[]>
  let total = 0
  for (const table of TABLES) {
    const input = value['tables'][table]
    if (!Array.isArray(input)) throw new Error('A synced device file is missing workspace data.')
    tables[table] = input.map((item) => {
      total += 1
      if (total > MAX_ROWS || !isRecord(item) || typeof item['syncUpdatedAt'] !== 'string' || !Number.isFinite(Date.parse(item['syncUpdatedAt']))) throw new Error('A synced device file contains an invalid record.')
      const row = item as Record<string, unknown>
      if (!recordId(table, row) || Object.values(row).some((cell) => cell !== null && typeof cell !== 'string' && typeof cell !== 'number')) throw new Error('A synced device file contains an invalid record value.')
      return row as SyncRow
    })
  }
  const seenTombstones = new Set<string>()
  const tombstones = value['tombstones'].map((item) => {
    if (!isRecord(item) || !TABLES.includes(item['table'] as SyncTable) || typeof item['id'] !== 'string' || !item['id'] || typeof item['deletedAt'] !== 'string' || !Number.isFinite(Date.parse(item['deletedAt'])) || typeof item['deviceId'] !== 'string' || !/^[0-9a-f-]{36}$/i.test(item['deviceId'])) throw new Error('A synced device file contains an invalid deletion record.')
    const tombstone = item as unknown as Tombstone
    const key = `${tombstone.table}:${tombstone.id}`
    if (seenTombstones.has(key)) throw new Error('A synced device file contains duplicate deletion records.')
    seenTombstones.add(key)
    return tombstone
  })
  if (total + tombstones.length > MAX_ROWS) throw new Error('A synced device file contains too many records.')
  return { version: 1, deviceId: expectedDeviceId, updatedAt: value['updatedAt'], tables, tombstones }
}

function isRecord(value: unknown): value is Record<string, unknown> { return value !== null && typeof value === 'object' && !Array.isArray(value) }
function isBase64(value: unknown): value is string { return typeof value === 'string' && value.length > 0 && value.length <= MAX_FILE_BYTES * 2 && /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value) }
