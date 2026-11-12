import { afterEach, describe, expect, it } from 'vitest'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { LifeStore } from '../src/core/lifeos'
import { PlanningStore } from '../src/core/planning'
import { syncSharedFolder } from '../src/core/folder-sync'

const DEVICE_A = '10000000-0000-4000-8000-000000000001'
const DEVICE_B = '20000000-0000-4000-8000-000000000002'
const PASSPHRASE = 'correct horse battery staple sync'

describe('encrypted shared-folder sync', () => {
  const roots: string[] = []
  const stores: Array<{ planning: PlanningStore; life: LifeStore }> = []

  afterEach(async () => {
    for (const store of stores.splice(0)) store.planning.close()
    for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true })
  })

  it('merges independent work, resolves concurrent edits, and carries deletions between devices', async () => {
    const root = await makeRoot(roots)
    const folder = path.join(root, 'shared')
    const a = await makeStore(root, 'device-a', stores)
    const b = await makeStore(root, 'device-b', stores)
    const taskA = a.planning.addTask({ title: 'Alpha task' })
    b.planning.addTask({ title: 'Beta task' })

    await syncSharedFolder(a.planning.database, folder, DEVICE_A, PASSPHRASE)
    await syncSharedFolder(b.planning.database, folder, DEVICE_B, PASSPHRASE)
    await syncSharedFolder(a.planning.database, folder, DEVICE_A, PASSPHRASE)
    expect(a.planning.listTasks(true).map((task) => task.title).sort()).toEqual(['Alpha task', 'Beta task'])

    a.planning.database.prepare('UPDATE tasks SET title = ?, updated_at = ? WHERE id = ?').run('Alpha from A', '2099-01-01T10:02:00.000Z', taskA.id)
    b.planning.database.prepare('UPDATE tasks SET title = ?, updated_at = ? WHERE id = ?').run('Alpha from B', '2099-01-01T10:01:00.000Z', taskA.id)
    await syncSharedFolder(b.planning.database, folder, DEVICE_B, PASSPHRASE)
    await syncSharedFolder(a.planning.database, folder, DEVICE_A, PASSPHRASE)
    await syncSharedFolder(b.planning.database, folder, DEVICE_B, PASSPHRASE)
    expect(b.planning.getTask(taskA.id).title).toBe('Alpha from A')

    const goal = a.life.saveGoal({ title: 'A shared goal' })
    await syncSharedFolder(a.planning.database, folder, DEVICE_A, PASSPHRASE)
    await syncSharedFolder(b.planning.database, folder, DEVICE_B, PASSPHRASE)
    expect(b.life.workspace().goals.some((item) => item.id === goal.id)).toBe(true)

    a.life.deleteGoal(goal.id)
    await syncSharedFolder(a.planning.database, folder, DEVICE_A, PASSPHRASE)
    await syncSharedFolder(b.planning.database, folder, DEVICE_B, PASSPHRASE)
    expect(b.life.workspace().goals.some((item) => item.id === goal.id)).toBe(false)
  })

  it('writes opaque authenticated snapshots and leaves local data unchanged for a wrong passphrase', async () => {
    const root = await makeRoot(roots)
    const folder = path.join(root, 'shared')
    const a = await makeStore(root, 'device-a', stores)
    const b = await makeStore(root, 'device-b', stores)
    a.planning.addTask({ title: 'Private task title' })
    b.planning.addTask({ title: 'Local-only task' })
    await syncSharedFolder(a.planning.database, folder, DEVICE_A, PASSPHRASE)

    const snapshot = await readFile(path.join(folder, `mike-assist-${DEVICE_A}.sync`), 'utf8')
    expect(snapshot).not.toContain('Private task title')
    await expect(syncSharedFolder(b.planning.database, folder, DEVICE_B, 'wrong passphrase here')).rejects.toThrow(/same passphrase/i)
    expect(b.planning.listTasks(true).map((task) => task.title)).toEqual(['Local-only task'])
  })

  it('defaults old journal snapshots without a pin column to unpinned', async () => {
    const root = await makeRoot(roots)
    const folder = path.join(root, 'shared')
    const a = await makeStore(root, 'device-a', stores)
    const b = await makeStore(root, 'device-b', stores)
    const note = a.life.saveJournal({ entryDate: '2026-11-12', title: 'An old note', content: 'Keep this.' })
    // Publish through the normal encryption path with the pre-pin journal schema.
    a.planning.database.exec('ALTER TABLE journal_entries DROP COLUMN is_pinned')

    await syncSharedFolder(a.planning.database, folder, DEVICE_A, PASSPHRASE)
    await syncSharedFolder(b.planning.database, folder, DEVICE_B, PASSPHRASE)

    expect(b.life.listJournal()).toEqual([{ ...note, isPinned: false }])
    expect(b.planning.database.prepare('SELECT is_pinned FROM journal_entries WHERE id = ?').get(note.id))
      .toMatchObject({ is_pinned: 0 })
  })

  it('syncs journal pin state from the newer row timestamp', async () => {
    const root = await makeRoot(roots)
    const folder = path.join(root, 'shared')
    const a = await makeStore(root, 'device-a', stores)
    const b = await makeStore(root, 'device-b', stores)
    const note = a.life.saveJournal({ entryDate: '2026-11-12', title: 'A shared note', content: 'Keep this handy.' })
    const initialTimestamp = '2026-01-01T10:00:00.000Z'
    a.planning.database.prepare('UPDATE journal_entries SET updated_at = ? WHERE id = ?').run(initialTimestamp, note.id)

    await syncSharedFolder(a.planning.database, folder, DEVICE_A, PASSPHRASE)
    await syncSharedFolder(b.planning.database, folder, DEVICE_B, PASSPHRASE)
    expect(b.life.listJournal()).toEqual([{ ...note, updatedAt: initialTimestamp, isPinned: false }])

    const pinned = a.life.setJournalPinned(note.id, true)
    expect(pinned.updatedAt > initialTimestamp).toBe(true)
    await syncSharedFolder(a.planning.database, folder, DEVICE_A, PASSPHRASE)
    await syncSharedFolder(b.planning.database, folder, DEVICE_B, PASSPHRASE)

    expect(b.life.listPinnedJournal()).toEqual([{ ...note, updatedAt: pinned.updatedAt, isPinned: true }])

    const unpinned = b.life.setJournalPinned(note.id, false)
    await syncSharedFolder(b.planning.database, folder, DEVICE_B, PASSPHRASE)
    await syncSharedFolder(a.planning.database, folder, DEVICE_A, PASSPHRASE)

    expect(a.life.listJournal()).toEqual([{ ...note, updatedAt: unpinned.updatedAt, isPinned: false }])
  })
})

async function makeRoot(roots: string[]): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), 'mike-assist-folder-sync-'))
  roots.push(root)
  return root
}

async function makeStore(root: string, name: string, stores: Array<{ planning: PlanningStore; life: LifeStore }>): Promise<{ planning: PlanningStore; life: LifeStore }> {
  const planning = new PlanningStore(path.join(root, name, 'planning.sqlite'))
  await planning.init()
  const life = new LifeStore(planning.database, planning)
  life.init()
  const store = { planning, life }
  stores.push(store)
  return store
}
