import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { GrantStore } from '../src/core/grants'
import { ToolError } from '../src/tools/paths'

let root = ''
let storeFile = ''
let store: GrantStore

beforeEach(async () => {
  root = await realpath(await mkdtemp(path.join(tmpdir(), 'mike-assist-grants-')))
  storeFile = path.join(await mkdtemp(path.join(tmpdir(), 'mike-assist-grants-file-')), 'grants.json')
  store = new GrantStore(storeFile)
  await store.init(root)
})

afterEach(async () => {
  await rm(root, { recursive: true, force: true })
  await rm(path.dirname(storeFile), { recursive: true, force: true })
})

describe('GrantStore', () => {
  it('creates a writable primary workspace grant', () => {
    const primary = store.primary()

    expect(primary.id).toBe('workspace')
    expect(primary.label).toBe('Workspace')
    expect(primary.root).toBe(root)
    expect(primary.access).toBe('read-write')
    expect(primary.builtIn).toBe(true)
    expect(store.list()).toHaveLength(1)
  })

  it('adds a folder and finds it by id or label', async () => {
    const folder = path.join(root, 'Course materials')
    await mkdir(folder)

    const grant = await store.add({ folderPath: folder, access: 'read' })

    expect(grant.label).toBe('Course materials')
    expect(grant.root).toBe(await realpath(folder))
    expect(store.get(grant.id).label).toBe('Course materials')
    expect(store.get('Course materials').id).toBe(grant.id)
    expect(store.get('course materials').id).toBe(grant.id)
    expect(store.list()).toHaveLength(2)
  })

  it('does not approve a folder in memory when saving its grant fails', async () => {
    const folder = path.join(root, 'not-saved')
    await mkdir(folder)
    await rm(storeFile)
    await mkdir(storeFile)

    await expect(store.add({ folderPath: folder, access: 'read-write' })).rejects.toBeDefined()

    expect(store.list()).toHaveLength(1)
    expect(store.list().some((grant) => grant.root === folder)).toBe(false)
  })

  it('does not revoke a folder in memory when saving the removal fails', async () => {
    const folder = path.join(root, 'kept-approved')
    await mkdir(folder)
    const grant = await store.add({ folderPath: folder, access: 'read' })
    await rm(storeFile)
    await mkdir(storeFile)

    await expect(store.remove(grant.id)).rejects.toBeDefined()

    expect(store.get(grant.id).root).toBe(folder)
  })

  it('treats empty and aliased root names as the primary workspace', () => {
    expect(store.get('').id).toBe('workspace')
    expect(store.get('workspace').id).toBe('workspace')
    expect(store.get('primary').id).toBe('workspace')
    expect(store.get('default').id).toBe('workspace')
  })

  it('rejects a folder that is already approved', async () => {
    const folder = path.join(root, 'notes')
    await mkdir(folder)
    await store.add({ folderPath: folder, access: 'read' })

    await expect(
      store.add({ folderPath: folder, access: 'read-write' })
    ).rejects.toBeInstanceOf(ToolError)

    await expect(
      store.add({ folderPath: `${folder}${path.sep}`, access: 'read' })
    ).rejects.toBeInstanceOf(ToolError)
  })

  it('rejects missing folders, files, relative paths, and network paths', async () => {
    const file = path.join(root, 'a-file.txt')
    await writeFile(file, 'x', 'utf8')

    await expect(
      store.add({ folderPath: path.join(root, 'missing'), access: 'read' })
    ).rejects.toBeInstanceOf(ToolError)

    await expect(store.add({ folderPath: file, access: 'read' })).rejects.toBeInstanceOf(ToolError)

    await expect(store.add({ folderPath: 'relative/folder', access: 'read' })).rejects.toBeInstanceOf(
      ToolError
    )

    await expect(
      store.add({ folderPath: '\\\\server\\share\\folder', access: 'read' })
    ).rejects.toBeInstanceOf(ToolError)
  })

  it('cannot remove or downgrade the primary grant', async () => {
    await expect(store.remove('workspace')).rejects.toBeInstanceOf(ToolError)
    await expect(store.setAccess('workspace', 'read')).rejects.toBeInstanceOf(ToolError)
  })

  it('changes access on other grants and persists it', async () => {
    const folder = path.join(root, 'papers')
    await mkdir(folder)
    const grant = await store.add({ folderPath: folder, access: 'read-write' })

    await store.setAccess(grant.id, 'read')
    expect(store.get(grant.id).access).toBe('read')

    const reloaded = new GrantStore(storeFile)
    await reloaded.init(root)
    expect(reloaded.get(grant.id).access).toBe('read')
  })

  it('removes a grant without touching the folder and persists it', async () => {
    const folder = path.join(root, 'papers')
    await mkdir(folder)
    const grant = await store.add({ folderPath: folder, access: 'read' })

    await store.remove(grant.id)
    expect(store.list()).toHaveLength(1)
    expect(() => store.get(grant.id)).toThrow(ToolError)

    const reloaded = new GrantStore(storeFile)
    await reloaded.init(root)
    expect(reloaded.list()).toHaveLength(1)
  })

  it('keeps labels unique when folder names collide', async () => {
    const first = path.join(root, 'one', 'notes')
    const second = path.join(root, 'two', 'notes')
    await mkdir(first, { recursive: true })
    await mkdir(second, { recursive: true })

    const a = await store.add({ folderPath: first, access: 'read' })
    const b = await store.add({ folderPath: second, access: 'read' })

    expect(a.label).toBe('notes')
    expect(b.label).not.toBe(a.label)
    expect(store.get(b.label).id).toBe(b.id)
  })

  it('reports available folders when a name is unknown', async () => {
    const folder = path.join(root, 'papers')
    await mkdir(folder)
    await store.add({ folderPath: folder, access: 'read' })

    expect(() => store.get('does-not-exist')).toThrow(/Workspace.*papers/s)
  })
})
