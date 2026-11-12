import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { DatabaseSync } from 'node:sqlite'
import {
  createBackupSnapshot,
  recoverInterruptedBackupRestore,
  restoreBackupSnapshot,
  verifyBackupSnapshot
} from '../src/core/backup'
import { PlanningStore } from '../src/core/planning'

const directories: string[] = []
const stores: PlanningStore[] = []

afterEach(async () => {
  for (const store of stores.splice(0)) store.close()
  for (const directory of directories.splice(0)) await rm(directory, { recursive: true, force: true })
})

async function createDataDirectory(prefix: string): Promise<{ root: string; store: PlanningStore }> {
  const root = await mkdtemp(path.join(tmpdir(), prefix))
  directories.push(root)
  await writeFile(path.join(root, 'settings.json'), JSON.stringify({ version: 2, provider: { preset: 'openai' } }), 'utf8')
  const store = new PlanningStore(path.join(root, 'planning.sqlite'))
  stores.push(store)
  await store.init()
  return { root, store }
}

describe('focused task backup and restore', () => {
  it('backs up local settings, tasks, and Inbox without old assistant databases', async () => {
    const source = await createDataDirectory('mike-assist-backup-source-')
    source.store.addTask({ title: 'Keep task' })
    source.store.capture('Keep inbox item')
    const target = path.join(await mkdtemp(path.join(tmpdir(), 'mike-assist-backup-target-')), 'backup')
    directories.push(path.dirname(target))

    await createBackupSnapshot(source.root, target, source.store, '0.2.0')
    const verification = await verifyBackupSnapshot(target)
    const manifest = JSON.parse(await readFile(path.join(target, 'manifest.json'), 'utf8')) as { includes: string[]; formatVersion: number }

    expect(verification.valid).toBe(true)
    expect(manifest).toMatchObject({ formatVersion: 2, includes: ['settings.json', 'planning.sqlite'] })
    await expect(readFile(path.join(target, 'finance.sqlite'))).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('restores task rows and encrypted provider settings while leaving legacy data alone', async () => {
    const source = await createDataDirectory('mike-assist-backup-source-')
    source.store.addTask({ title: 'Saved task' })
    source.store.capture('Saved Inbox item')
    const backupParent = await mkdtemp(path.join(tmpdir(), 'mike-assist-backup-'))
    directories.push(backupParent)
    const backupDir = path.join(backupParent, 'backup')
    await createBackupSnapshot(source.root, backupDir, source.store, '0.2.0', { passphrase: 'correct horse' })

    const current = await createDataDirectory('mike-assist-current-')
    current.store.addTask({ title: 'Temporary task' })
    await writeFile(path.join(current.root, 'finance.sqlite'), 'legacy finance remains', 'utf8')
    let reopened = false
    const result = await restoreBackupSnapshot(backupDir, current.root, {
      passphrase: 'correct horse',
      closeStores: () => current.store.close(),
      reopenStores: async () => { await current.store.init(); reopened = true }
    })

    expect(result.restoredFiles).toEqual(['settings.json', 'planning.sqlite'])
    expect(reopened).toBe(true)
    expect(current.store.listTasks().map((task) => task.title)).toEqual(['Saved task'])
    expect(current.store.snapshot().inbox.map((item) => item.text)).toEqual(['Saved Inbox item'])
    expect(await readFile(path.join(current.root, 'finance.sqlite'), 'utf8')).toBe('legacy finance remains')
    expect((await verifyBackupSnapshot(backupDir)).error).toMatch(/passphrase/i)
    expect((await verifyBackupSnapshot(backupDir, { passphrase: 'wrong' })).valid).toBe(false)
    expect((await verifyBackupSnapshot(backupDir, { passphrase: 'correct horse' })).valid).toBe(true)
  })

  it('imports only task data from an older full-assistant backup', async () => {
    const source = await createDataDirectory('mike-assist-legacy-backup-source-')
    source.store.addTask({ title: 'Legacy backup task' })
    source.store.capture('Legacy backup Inbox')
    const backupParent = await mkdtemp(path.join(tmpdir(), 'mike-assist-legacy-backup-'))
    directories.push(backupParent)
    const backupDir = path.join(backupParent, 'legacy')
    await mkdir(backupDir)
    await source.store.backupTo(path.join(backupDir, 'planning.sqlite'))
    await writeFile(path.join(backupDir, 'settings.json'), await readFile(path.join(source.root, 'settings.json')))
    for (const name of ['conversations.sqlite', 'finance.sqlite', 'memory.sqlite', 'grants.json', 'allowed-domains.json']) {
      await writeFile(path.join(backupDir, name), `old ${name}`, 'utf8')
    }
    await mkdir(path.join(backupDir, 'audit'))
    await writeFile(path.join(backupDir, 'audit', 'events.jsonl'), '{}\n', 'utf8')
    const includes = ['conversations.sqlite', 'finance.sqlite', 'memory.sqlite', 'settings.json', 'grants.json', 'allowed-domains.json', 'planning.sqlite', 'audit/']
    await writeFile(path.join(backupDir, 'manifest.json'), JSON.stringify({ formatVersion: 1, appVersion: '0.1.0', createdAt: new Date().toISOString(), includes }), 'utf8')

    const current = await createDataDirectory('mike-assist-legacy-current-')
    await writeFile(path.join(current.root, 'finance.sqlite'), 'keep current finance', 'utf8')
    await restoreBackupSnapshot(backupDir, current.root, {
      closeStores: () => current.store.close(),
      reopenStores: () => current.store.init()
    })

    expect(current.store.listTasks().map((task) => task.title)).toEqual(['Legacy backup task'])
    expect(current.store.snapshot().inbox.map((item) => item.text)).toEqual(['Legacy backup Inbox'])
    expect(await readFile(path.join(current.root, 'finance.sqlite'), 'utf8')).toBe('keep current finance')
  })

  it('rejects a readable SQLite backup missing task write columns before replacing app data', async () => {
    const source = await createDataDirectory('mike-assist-invalid-backup-source-')
    const backupParent = await mkdtemp(path.join(tmpdir(), 'mike-assist-invalid-backup-'))
    directories.push(backupParent)
    const backupDir = path.join(backupParent, 'backup')
    await createBackupSnapshot(source.root, backupDir, source.store, '0.2.0')

    const planningPath = path.join(backupDir, 'planning.sqlite')
    await rm(planningPath)
    const malformed = new DatabaseSync(planningPath)
    malformed.exec(`CREATE TABLE tasks (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      notes TEXT NOT NULL,
      due_date TEXT,
      priority TEXT NOT NULL DEFAULT 'normal',
      status TEXT NOT NULL DEFAULT 'open',
      created_at TEXT NOT NULL,
      completed_at TEXT
    )`)
    malformed.close()

    const current = await createDataDirectory('mike-assist-invalid-current-')
    current.store.addTask({ title: 'Keep current task' })
    const verification = await verifyBackupSnapshot(backupDir)
    expect(verification.valid).toBe(false)
    expect(verification.error).toMatch(/incompatible/i)
    await expect(restoreBackupSnapshot(backupDir, current.root, {
      closeStores: () => current.store.close(),
      reopenStores: () => current.store.init()
    })).rejects.toThrow(/incompatible/i)
    expect(current.store.listTasks().map((task) => task.title)).toEqual(['Keep current task'])
  })

  it('rejects a backup whose dormant trigger could delete tasks after restore', async () => {
    const source = await createDataDirectory('mike-assist-trigger-backup-source-')
    source.store.addTask({ title: 'Keep this task in the backup' })
    const db = (source.store as unknown as { db: DatabaseSync }).db
    db.exec(`CREATE TRIGGER sqliteCleanup_malicious AFTER INSERT ON tasks
      WHEN NEW.title NOT IN ('Restore validation', 'Restore validation updated', 'Restore recurring task')
      BEGIN DELETE FROM tasks WHERE title = 'Keep this task in the backup'; END`)
    db.exec(`CREATE TRIGGER sqliteTrigger_malicious AFTER INSERT ON tasks
      WHEN NEW.title NOT IN ('Restore validation', 'Restore validation updated', 'Restore recurring task')
      BEGIN DELETE FROM tasks WHERE title = 'Keep this task in the backup'; END`)
    const backupParent = await mkdtemp(path.join(tmpdir(), 'mike-assist-trigger-backup-'))
    directories.push(backupParent)
    const backupDir = path.join(backupParent, 'backup')
    await createBackupSnapshot(source.root, backupDir, source.store, '0.2.0')

    const current = await createDataDirectory('mike-assist-trigger-current-')
    current.store.addTask({ title: 'Keep current task' })
    const verification = await verifyBackupSnapshot(backupDir)

    expect(verification.valid).toBe(false)
    expect(verification.error).toMatch(/trigger|schema|incompatible/i)
    await expect(restoreBackupSnapshot(backupDir, current.root, {
      closeStores: () => current.store.close(),
      reopenStores: () => current.store.init()
    })).rejects.toThrow(/trigger|schema|incompatible/i)
    expect(current.store.listTasks().map((task) => task.title)).toEqual(['Keep current task'])
  })

  it('rejects SQLite check expressions before backup validation writes', async () => {
    const source = await createDataDirectory('mike-assist-check-expression-source-')
    const db = (source.store as unknown as { db: DatabaseSync }).db
    db.exec('ALTER TABLE tasks ADD COLUMN imported_guard TEXT CHECK (length(zeroblob(1024)) > 0)')
    const backupParent = await mkdtemp(path.join(tmpdir(), 'mike-assist-check-expression-backup-'))
    directories.push(backupParent)
    const backupDir = path.join(backupParent, 'backup')
    await createBackupSnapshot(source.root, backupDir, source.store, '0.2.0')

    const verification = await verifyBackupSnapshot(backupDir)

    expect(verification.valid).toBe(false)
    expect(verification.error).toMatch(/unsupported SQLite check expression/i)
  })

  it('rejects generated columns in imported SQLite tables', async () => {
    const source = await createDataDirectory('mike-assist-generated-column-source-')
    const db = (source.store as unknown as { db: DatabaseSync }).db
    db.exec('ALTER TABLE tasks ADD COLUMN imported_value INTEGER GENERATED ALWAYS AS (length(zeroblob(1024))) VIRTUAL')
    const backupParent = await mkdtemp(path.join(tmpdir(), 'mike-assist-generated-column-backup-'))
    directories.push(backupParent)
    const backupDir = path.join(backupParent, 'backup')
    await createBackupSnapshot(source.root, backupDir, source.store, '0.2.0')

    const verification = await verifyBackupSnapshot(backupDir)

    expect(verification.valid).toBe(false)
    expect(verification.error).toMatch(/unsupported generated column/i)
  })

  it('rejects expression indexes in imported SQLite databases', async () => {
    const source = await createDataDirectory('mike-assist-expression-index-source-')
    const db = (source.store as unknown as { db: DatabaseSync }).db
    db.exec('CREATE INDEX imported_expression ON tasks(length(zeroblob(1024)))')
    const backupParent = await mkdtemp(path.join(tmpdir(), 'mike-assist-expression-index-backup-'))
    directories.push(backupParent)
    const backupDir = path.join(backupParent, 'backup')
    await createBackupSnapshot(source.root, backupDir, source.store, '0.2.0')

    const verification = await verifyBackupSnapshot(backupDir)

    expect(verification.valid).toBe(false)
    expect(verification.error).toMatch(/unsupported SQLite expression index/i)
  })

  it('keeps compatible with legacy provider and task export constraints', async () => {
    const source = await createDataDirectory('mike-assist-legacy-schema-backup-source-')
    source.store.addTask({ title: 'Legacy schema task' })
    const db = (source.store as unknown as { db: DatabaseSync }).db
    db.exec(`
      ALTER TABLE tasks ADD COLUMN source_email_provider TEXT
        CHECK (source_email_provider IS NULL OR source_email_provider IN ('gmail', 'outlook'));
      ALTER TABLE tasks ADD COLUMN source_calendar_provider TEXT
        CHECK (source_calendar_provider IS NULL OR source_calendar_provider IN ('google_calendar', 'microsoft_calendar'));
      ALTER TABLE tasks ADD COLUMN source_task_provider TEXT
        CHECK (source_task_provider IS NULL OR source_task_provider IN ('google_tasks', 'microsoft_todo'));
      CREATE TABLE task_exports (
        id TEXT PRIMARY KEY,
        task_id TEXT,
        provider TEXT CHECK (provider IN ('google_tasks', 'microsoft_todo')),
        status TEXT CHECK (status IN ('sending', 'sent', 'failed', 'uncertain')),
        sync_status TEXT NOT NULL DEFAULT 'idle' CHECK (sync_status IN ('idle', 'sending', 'failed', 'uncertain')),
        synced_priority TEXT CHECK (synced_priority IS NULL OR synced_priority IN ('low', 'normal', 'high')),
        remote_task_id TEXT
      );
      INSERT INTO task_exports (id, task_id, provider, status, remote_task_id)
        VALUES ('legacy-export', 'legacy-task', 'google_tasks', 'sent', 'remote-id');
    `)
    const backupParent = await mkdtemp(path.join(tmpdir(), 'mike-assist-legacy-schema-backup-'))
    directories.push(backupParent)
    const backupDir = path.join(backupParent, 'backup')
    await createBackupSnapshot(source.root, backupDir, source.store, '0.2.0')

    const verification = await verifyBackupSnapshot(backupDir)

    expect(verification.valid).toBe(true)
    const current = await createDataDirectory('mike-assist-legacy-schema-restore-')
    await restoreBackupSnapshot(backupDir, current.root, {
      closeStores: () => current.store.close(),
      reopenStores: () => current.store.init()
    })
    expect(current.store.listTasks().map((task) => task.title)).toEqual(['Legacy schema task'])
    const restored = new DatabaseSync(path.join(current.root, 'planning.sqlite'), { readOnly: true })
    try {
      expect(restored.prepare("SELECT remote_task_id FROM task_exports WHERE id = 'legacy-export'").get()).toEqual({ remote_task_id: 'remote-id' })
    } finally { restored.close() }
  })

  it('rejects a backup containing a recursive view that could exhaust query resources', async () => {
    const source = await createDataDirectory('mike-assist-recursive-view-source-')
    source.store.addTask({ title: 'Keep this task in the backup' })
    const backupParent = await mkdtemp(path.join(tmpdir(), 'mike-assist-recursive-view-backup-'))
    directories.push(backupParent)
    const backupDir = path.join(backupParent, 'backup')
    await createBackupSnapshot(source.root, backupDir, source.store, '0.2.0')

    const planningPath = path.join(backupDir, 'planning.sqlite')
    const malformed = new DatabaseSync(planningPath)
    malformed.exec(`
      DROP TABLE task_areas;
      CREATE VIEW task_areas(id, name, icon, color, sort_order, created_at) AS
        WITH RECURSIVE generated(id) AS (
          SELECT 1 UNION ALL SELECT id + 1 FROM generated
        )
        SELECT id, 'Generated area', 'briefcase', 'teal', id, '2026-01-01T00:00:00.000Z' FROM generated;
    `)
    malformed.close()

    const current = await createDataDirectory('mike-assist-recursive-view-current-')
    current.store.addTask({ title: 'Keep current task' })
    const verification = await verifyBackupSnapshot(backupDir)
    expect(verification.valid).toBe(false)
    expect(verification.error).toMatch(/unsupported SQLite view/i)
    await expect(restoreBackupSnapshot(backupDir, current.root, {
      closeStores: () => current.store.close(),
      reopenStores: () => current.store.init()
    })).rejects.toThrow(/unsupported SQLite view/i)
    expect(current.store.listTasks().map((task) => task.title)).toEqual(['Keep current task'])
  })

  it.each(['ROLLBACK', 'ABORT', 'FAIL', 'IGNORE', 'REPLACE'] as const)('rejects a backup with a custom task conflict policy: %s', async (policy) => {
    const source = await createDataDirectory('mike-assist-conflict-backup-source-')
    const area = source.store.createArea({ name: 'Existing Area', icon: 'briefcase', color: 'teal' })
    const project = source.store.createProject({ name: 'Existing Project', areaId: area.id })
    source.store.addTask({ title: 'Keep this task in the backup', projectId: project.id })
    const db = (source.store as unknown as { db: DatabaseSync }).db
    db.exec(`
      DROP INDEX tasks_due_status;
      DROP INDEX inbox_active;
      DROP INDEX tasks_planned_day;
      DROP INDEX tasks_project_stage;
      DROP INDEX projects_area;
      DROP INDEX tasks_recurrence_series_date;
      ALTER TABLE tasks RENAME TO tasks_original;
      CREATE TABLE tasks (
        id TEXT PRIMARY KEY, title TEXT NOT NULL, notes TEXT NOT NULL, due_date TEXT,
        planned_date TEXT, day_order INTEGER, project_id TEXT, workflow_stage TEXT NOT NULL DEFAULT 'next',
        remind_at TEXT, reminder_notified_at TEXT,
        priority TEXT NOT NULL CHECK (priority IN ('low', 'normal', 'high')),
        status TEXT NOT NULL CHECK (status IN ('open', 'done', 'cancelled')),
        created_at TEXT NOT NULL, updated_at TEXT NOT NULL, completed_at TEXT,
        parent_task_id TEXT, source_inbox_id TEXT,
        recurrence_rule TEXT, recurrence_date TEXT, recurrence_series_id TEXT,
        UNIQUE(project_id) ON CONFLICT ${policy}
      );
      INSERT INTO tasks SELECT * FROM tasks_original;
      DROP TABLE tasks_original;
    `)
    const backupParent = await mkdtemp(path.join(tmpdir(), 'mike-assist-conflict-backup-'))
    directories.push(backupParent)
    const backupDir = path.join(backupParent, 'backup')
    await createBackupSnapshot(source.root, backupDir, source.store, '0.2.0')

    const verification = await verifyBackupSnapshot(backupDir)

    expect(verification.valid).toBe(false)
    expect(verification.error).toMatch(/unsupported|schema|conflict/i)
  })

  it('rejects a conflict policy after a quoted double-hyphen string', async () => {
    const source = await createDataDirectory('mike-assist-quoted-conflict-backup-source-')
    const db = (source.store as unknown as { db: DatabaseSync }).db
    db.exec(`
      DROP INDEX tasks_due_status;
      DROP INDEX inbox_active;
      DROP INDEX tasks_planned_day;
      DROP INDEX tasks_project_stage;
      DROP INDEX projects_area;
      DROP INDEX tasks_recurrence_series_date;
      ALTER TABLE tasks RENAME TO tasks_original;
      CREATE TABLE tasks (
        id TEXT PRIMARY KEY, title TEXT NOT NULL DEFAULT '--', notes TEXT NOT NULL, due_date TEXT,
        planned_date TEXT, day_order INTEGER, project_id TEXT, workflow_stage TEXT NOT NULL DEFAULT 'next',
        remind_at TEXT, reminder_notified_at TEXT,
        priority TEXT NOT NULL CHECK (priority IN ('low', 'normal', 'high')),
        status TEXT NOT NULL CHECK (status IN ('open', 'done', 'cancelled')),
        created_at TEXT NOT NULL, updated_at TEXT NOT NULL, completed_at TEXT,
        parent_task_id TEXT, source_inbox_id TEXT,
        recurrence_rule TEXT, recurrence_date TEXT, recurrence_series_id TEXT,
        UNIQUE(title) ON CONFLICT REPLACE
      );
      INSERT INTO tasks SELECT * FROM tasks_original;
      DROP TABLE tasks_original;
    `)
    const backupParent = await mkdtemp(path.join(tmpdir(), 'mike-assist-quoted-conflict-backup-'))
    directories.push(backupParent)
    const backupDir = path.join(backupParent, 'backup')
    await createBackupSnapshot(source.root, backupDir, source.store, '0.2.0')

    const verification = await verifyBackupSnapshot(backupDir)

    expect(verification.valid).toBe(false)
    expect(verification.error).toMatch(/unsupported|schema|conflict/i)
  })

  it('recovers a pending task restore from its local checkpoint', async () => {
    const current = await createDataDirectory('mike-assist-restore-recovery-')
    current.store.close()
    const transaction = path.join(current.root, '.mike-assist-restore-pending-0123456789abcdef')
    await mkdir(path.join(transaction, 'previous'), { recursive: true })
    await writeFile(path.join(transaction, 'previous', 'settings.json'), await readFile(path.join(current.root, 'settings.json')))
    await writeFile(path.join(transaction, 'previous', 'planning.sqlite'), 'previous task database')
    await writeFile(path.join(transaction, 'transaction.json'), JSON.stringify({
      version: 2,
      entries: ['settings.json', 'planning.sqlite'],
      previousEntries: ['settings.json', 'planning.sqlite']
    }))
    await writeFile(path.join(current.root, 'settings.json'), 'partial restore')
    await writeFile(path.join(current.root, 'planning.sqlite'), 'partial restore')

    await recoverInterruptedBackupRestore(current.root)

    expect(JSON.parse(await readFile(path.join(current.root, 'settings.json'), 'utf8')).version).toBe(2)
    expect(await readFile(path.join(current.root, 'planning.sqlite'), 'utf8')).toBe('previous task database')
    await expect(readFile(transaction)).rejects.toBeDefined()
  })

  it('rejects a backup destination inside app data', async () => {
    const source = await createDataDirectory('mike-assist-backup-nesting-')
    await expect(createBackupSnapshot(source.root, path.join(source.root, 'nested'), source.store, '0.2.0')).rejects.toThrow(/outside/i)
  })
})
