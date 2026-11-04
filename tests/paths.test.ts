import { mkdir, mkdtemp, realpath, rm, symlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { FolderGrant } from '../src/shared/types'
import { isPathInside, pathContext, resolveGrantPath, ToolError } from '../src/tools/paths'

let root = ''
let outside = ''

function grantFor(folder: string): FolderGrant {
  return {
    id: 'test',
    label: 'Test',
    root: folder,
    access: 'read-write',
    createdAt: new Date().toISOString()
  }
}

beforeEach(async () => {
  root = await realpath(await mkdtemp(path.join(tmpdir(), 'mike-assist-root-')))
  outside = await realpath(await mkdtemp(path.join(tmpdir(), 'mike-assist-outside-')))
})

afterEach(async () => {
  await rm(root, { recursive: true, force: true })
  await rm(outside, { recursive: true, force: true })
})

describe('resolveGrantPath', () => {
  it('resolves a nested path that does not exist yet', async () => {
    const resolved = await resolveGrantPath(grantFor(root), 'notes/hello.md')
    expect(resolved.path).toBe(path.join(root, 'notes', 'hello.md'))
    expect(resolved.relative).toBe(path.join('notes', 'hello.md'))
  })

  it('treats an empty path and "." as the grant root', async () => {
    expect(await resolveGrantPath(grantFor(root), '')).toEqual({ path: root, relative: '.' })
    expect(await resolveGrantPath(grantFor(root), '.')).toEqual({ path: root, relative: '.' })
  })

  it('blocks parent-directory escapes', async () => {
    await expect(resolveGrantPath(grantFor(root), '../escape.txt')).rejects.toBeInstanceOf(ToolError)
    await expect(
      resolveGrantPath(grantFor(root), 'nested/../../escape.txt')
    ).rejects.toBeInstanceOf(ToolError)
  })

  it('blocks absolute paths', async () => {
    await expect(
      resolveGrantPath(grantFor(root), path.join(outside, 'escape.txt'))
    ).rejects.toBeInstanceOf(ToolError)
  })

  it('blocks UNC paths', async () => {
    await expect(resolveGrantPath(grantFor(root), '\\\\server\\share\\x')).rejects.toBeInstanceOf(
      ToolError
    )
  })

  it('blocks NUL bytes', async () => {
    await expect(resolveGrantPath(grantFor(root), 'a\0b')).rejects.toBeInstanceOf(ToolError)
  })

  it('blocks symlink escapes', async () => {
    const link = path.join(root, 'outside-link')
    try {
      await symlink(outside, link, 'junction')
    } catch {
      return
    }

    await expect(
      resolveGrantPath(grantFor(root), 'outside-link/secret.txt')
    ).rejects.toBeInstanceOf(ToolError)
  })

  it('allows symlinks that stay inside the grant', async () => {
    const target = path.join(root, 'real')
    await mkdir(target)
    const link = path.join(root, 'alias')

    try {
      await symlink(target, link, 'junction')
    } catch {
      return
    }

    const resolved = await resolveGrantPath(grantFor(root), 'alias/file.txt')
    expect(resolved.path).toBe(path.join(root, 'real', 'file.txt'))
  })
})

describe('isPathInside', () => {
  it('accepts the root and nested paths', () => {
    expect(isPathInside(root, root)).toBe(true)
    expect(isPathInside(root, path.join(root, 'a', 'b'))).toBe(true)
  })

  it('rejects siblings and parents', () => {
    expect(isPathInside(root, outside)).toBe(false)
    expect(isPathInside(root, path.dirname(root))).toBe(false)
  })
})

describe('pathContext', () => {
  it('narrows a path context', () => {
    const grant = grantFor(root)
    const signal = new AbortController().signal
    expect(pathContext({ kind: 'path', signal, path: root, grant, relative: '.' }).path).toBe(root)
  })

  it('throws when the context has no path', () => {
    const signal = new AbortController().signal
    expect(() => pathContext({ kind: 'none', signal })).toThrow(ToolError)
  })
})
