import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
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
