import { realpath } from 'node:fs/promises'
import path from 'node:path'
import type { FolderGrant, ToolContext } from '../shared/types'

export class ToolError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ToolError'
  }
}

/** True when `target` is the same as, or nested inside, `root`. */
export function isPathInside(root: string, target: string): boolean {
  const relative = path.relative(root, target)
  return (
    relative === '' ||
    (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative))
  )
}

/**
 * Resolves the nearest existing ancestor with realpath so symlinks cannot be
 * used to escape a grant, then re-appends the not-yet-existing tail.
 */
async function realpathNearest(target: string): Promise<string> {
  const missing: string[] = []
  let current = target

  for (;;) {
    try {
      const real = await realpath(current)
      return missing.length > 0 ? path.join(real, ...missing.reverse()) : real
    } catch {
      const parent = path.dirname(current)
      if (parent === current) {
        throw new ToolError('Could not resolve that path.')
      }
      missing.push(path.basename(current))
      current = parent
    }
  }
}

/**
 * Converts untrusted model input into a canonical path inside an approved
 * folder. Returns both the absolute path and a display-relative path.
 */
export async function resolveGrantPath(
  grant: FolderGrant,
  input: string
): Promise<{ path: string; relative: string }> {
  const raw = (input ?? '').trim()

  if (raw.includes('\0')) {
    throw new ToolError('Path is invalid.')
  }
  if (path.isAbsolute(raw) || raw.startsWith('\\\\') || raw.startsWith('//')) {
    throw new ToolError(
      `Absolute paths are not allowed. Use a path relative to the "${grant.label}" folder.`
    )
  }

  const root = await realpath(grant.root)
  const candidate = path.resolve(root, raw === '' ? '.' : raw)
  const target = await realpathNearest(candidate)

  if (!isPathInside(root, target)) {
    throw new ToolError(`Path is outside the "${grant.label}" folder.`)
  }

  return { path: target, relative: path.relative(root, target) || '.' }
}

export function toRelative(root: string, target: string): string {
  return path.relative(root, target) || '.'
}

/** Narrows a validated context to the path variant, or throws. */
export function pathContext(ctx: ToolContext): Extract<ToolContext, { kind: 'path' }> {
  if (ctx.kind !== 'path') {
    throw new ToolError('This tool needs a folder path, but none was resolved.')
  }
  return ctx
}
