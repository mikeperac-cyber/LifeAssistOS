import { mkdir, open, readFile, readdir, rename, stat, unlink, writeFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import path from 'node:path'
import { z } from 'zod'
import { checkpointHash, FileCheckpointStore, MAX_CHECKPOINT_FILE_BYTES } from '../core/file-checkpoints'
import type { ToolDef } from '../shared/types'
import { pathContext, resolveGrantPath, ToolError } from './paths'

const rootField = z
  .string()
  .optional()
  .describe('Approved folder to use. Omit for the primary workspace.')

const listInput = z.object({
  root: rootField,
  path: z.string().optional().describe('Relative path inside the folder. Empty means the folder itself.'),
  startIndex: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER).optional()
    .describe('Entry offset for continuing a truncated folder listing.')
})

type ListArgs = z.infer<typeof listInput>

interface DirEntry {
  name: string
  type: 'file' | 'directory' | 'other'
  size?: number
}

interface ListOutput {
  root: string
  path: string
  entries: DirEntry[]
  startIndex: number
  totalEntries: number
  nextIndex?: number
  truncated: boolean
}

const MAX_LIST_TOOL_RESULT_CHARS = 7_000
const MAX_LIST_PAGE_ENTRIES = 500

export const listDirTool: ToolDef<ListArgs, ListOutput> = {
  name: 'list_dir',
  description:
    'List files and folders inside an approved folder. Use an empty path to list the folder itself. If truncated, continue at startIndex=nextIndex.',
  risk: 'read',
  input: listInput,
  async scope(args, ctx) {
    const grant = ctx.grants.get(args.root)
    const resolved = await resolveGrantPath(grant, args.path ?? '')
    return {
      kind: 'path',
      grantId: grant.id,
      grantLabel: grant.label,
      path: resolved.path,
      relative: resolved.relative
    }
  },
  async run(args, ctx) {
    const { path: target, grant, relative } = pathContext(ctx)
    const dirents = await readdir(target, { withFileTypes: true })
    dirents.sort((left, right) => {
      const leftRank = left.isDirectory() ? 0 : 1
      const rightRank = right.isDirectory() ? 0 : 1
      return leftRank - rightRank || left.name.localeCompare(right.name)
    })
    const startIndex = args.startIndex ?? 0
    if (startIndex > dirents.length) throw new ToolError(`That folder has ${dirents.length} entries.`)
    const page = dirents.slice(startIndex, startIndex + MAX_LIST_PAGE_ENTRIES)

    const entries: DirEntry[] = await Promise.all(
      page.map(async (dirent) => {
        const type: DirEntry['type'] = dirent.isDirectory()
          ? 'directory'
          : dirent.isFile()
            ? 'file'
            : 'other'

        let size: number | undefined
        if (type === 'file') {
          try {
            size = (await stat(path.join(target, dirent.name))).size
          } catch {
            size = undefined
          }
        }

        return { name: dirent.name, type, size }
      })
    )

    let pageSize = entries.length
    const outputForPage = (size: number): ListOutput => {
      const selected = entries.slice(0, size)
      const nextIndex = startIndex + selected.length
      const truncated = nextIndex < dirents.length
      return {
        root: grant.label,
        path: relative,
        entries: selected,
        startIndex,
        totalEntries: dirents.length,
        ...(truncated ? { nextIndex } : {}),
        truncated
      }
    }

    while (pageSize > 1 && JSON.stringify({ ok: true, output: outputForPage(pageSize) }).length > MAX_LIST_TOOL_RESULT_CHARS) {
      pageSize = Math.max(1, Math.floor(pageSize * 0.75))
    }

    return outputForPage(pageSize)
  }
}

const readInput = z.object({
  root: rootField,
  path: z.string().describe('Relative path to the file.'),
  startByte: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER)
    .describe('Byte offset for continuing a truncated UTF-8 text read.')
    .optional(),
  maxBytes: z.number().int().min(4).max(1_000_000).optional()
})

type ReadArgs = z.infer<typeof readInput>

interface ReadOutput {
  root: string
  path: string
  content: string
  bytes: number
  startByte: number
  bytesRead: number
  nextByte?: number
  truncated: boolean
}

export const readFileTool: ToolDef<ReadArgs, ReadOutput> = {
  name: 'read_file',
  description:
    'Read a bounded UTF-8 text excerpt inside an approved folder. Continue a truncated result with startByte set to nextByte; excerpts end on UTF-8 character boundaries.',
  risk: 'read',
  input: readInput,
  async scope(args, ctx) {
    const grant = ctx.grants.get(args.root)
    const resolved = await resolveGrantPath(grant, args.path)
    return {
      kind: 'path',
      grantId: grant.id,
      grantLabel: grant.label,
      path: resolved.path,
      relative: resolved.relative
    }
  },
  async run(args, ctx) {
    const { path: target, grant, relative } = pathContext(ctx)
    const info = await stat(target)

    if (info.isDirectory()) {
      throw new ToolError('That path is a directory, not a file.')
    }

    const limit = Math.min(args.maxBytes ?? 64_000, 1_000_000)
    const startByte = args.startByte ?? 0
    if (startByte > info.size) throw new ToolError(`That file has ${info.size} bytes.`)
    const length = Math.min(info.size - startByte, limit)
    const handle = await open(target, 'r')

    try {
      const sampleLength = Math.min(info.size, 1024)
      const sample = Buffer.alloc(sampleLength)
      if (sampleLength > 0) {
        let sampleOffset = 0
        while (sampleOffset < sampleLength) {
          const read = await handle.read(sample, sampleOffset, sampleLength - sampleOffset, sampleOffset)
          if (read.bytesRead === 0) break
          sampleOffset += read.bytesRead
        }
      }
      if (sample.includes(0)) {
        throw new ToolError('That file appears to be binary, so I will not read it as text.')
      }

      const buffer = Buffer.alloc(length)
      let offset = 0
      while (offset < length) {
        const read = await handle.read(buffer, offset, length - offset, startByte + offset)
        if (read.bytesRead === 0) break
        offset += read.bytesRead
      }
      if (offset !== length) throw new ToolError('The file changed while it was being read; try again.')

      const safeLength = utf8CompletePrefixLength(buffer, startByte + length < info.size)
      const content = buffer.subarray(0, safeLength).toString('utf8')
      const nextByte = startByte + safeLength
      const truncated = nextByte < info.size

      return {
        root: grant.label,
        path: relative,
        content,
        bytes: info.size,
        startByte,
        bytesRead: safeLength,
        ...(truncated ? { nextByte } : {}),
        truncated
      }
    } finally {
      await handle.close()
    }
  }
}

function utf8CompletePrefixLength(buffer: Buffer, hasMore: boolean): number {
  if (!hasMore || buffer.length === 0) return buffer.length
  let leadIndex = buffer.length - 1
  while (leadIndex >= 0 && (buffer[leadIndex] & 0xc0) === 0x80) leadIndex -= 1
  if (leadIndex < 0) return buffer.length

  const lead = buffer[leadIndex]
  const expectedLength = lead <= 0x7f
    ? 1
    : lead >= 0xc2 && lead <= 0xdf
      ? 2
      : lead >= 0xe0 && lead <= 0xef
        ? 3
        : lead >= 0xf0 && lead <= 0xf4
          ? 4
          : 1
  const presentLength = buffer.length - leadIndex
  return expectedLength > presentLength ? leadIndex : buffer.length
}

const writeInput = z.object({
  root: rootField,
  path: z.string().describe('Relative path to the file to create or overwrite.'),
  content: z.string().max(1_000_000)
})

type WriteArgs = z.infer<typeof writeInput>

interface WriteOutput {
  root: string
  path: string
  bytes: number
  created: boolean
  checkpointId?: string
}

export function createWriteFileTool(checkpoints?: FileCheckpointStore): ToolDef<WriteArgs, WriteOutput> {
  const previewHashes = new Map<string, string | null>()
  const rememberPreview = (key: string, hash: string | null): void => {
    previewHashes.delete(key)
    previewHashes.set(key, hash)
    while (previewHashes.size > 64) {
      const oldest = previewHashes.keys().next().value
      if (oldest === undefined) break
      previewHashes.delete(oldest)
    }
  }

  return {
    name: 'write_file',
    description: checkpoints
      ? 'Create or overwrite a UTF-8 text file inside a writable approved folder. A bounded local restore point is kept before the write; use list_file_checkpoints and restore_file_checkpoint to undo or redo a change.'
      : 'Create or overwrite a UTF-8 text file inside a writable approved folder.',
    risk: 'write',
    input: writeInput,
    async scope(args, ctx) {
      const grant = ctx.grants.get(args.root)
      const resolved = await resolveGrantPath(grant, args.path)
      return {
        kind: 'path',
        grantId: grant.id,
        grantLabel: grant.label,
        path: resolved.path,
        relative: resolved.relative
      }
    },
    async preview(args, ctx) {
      const { path: target, grant, relative } = pathContext(ctx)
      const previewKey = checkpointPreviewKey(grant.id, relative, args.content)

      let existingSize: number | null = null
      let existingPreview = ''
      let directory = false

      try {
        const info = await stat(target)
        if (info.isDirectory()) {
          directory = true
        } else {
          existingSize = info.size
          if (checkpoints) {
            const content = await readCheckpointableFile(target)
            if (content === null) throw new ToolError('The file changed while its proposed write was being previewed. Try again.')
            rememberPreview(previewKey, checkpointHash(content))
            existingPreview = content.subarray(0, 4000).toString('utf8')
          } else {
            const handle = await open(target, 'r')
            try {
              const length = Math.min(info.size, 4000)
              const buffer = Buffer.alloc(length)
              await handle.read(buffer, 0, length, 0)
              existingPreview = buffer.toString('utf8')
            } finally {
              await handle.close()
            }
          }
        }
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
        existingSize = null
      }

      if (directory) {
        return `Directory · ${grant.label}/${relative}\n\nThis path is a folder. Writing here will fail.`
      }

      if (checkpoints && existingSize === null) rememberPreview(previewKey, null)

      const header =
        existingSize === null
          ? `New file · ${grant.label}/${relative}`
          : `Overwrite · ${grant.label}/${relative} (${existingSize.toLocaleString()} → ${args.content.length.toLocaleString()} chars)`

      const body =
        args.content.length > 4000
          ? `${args.content.slice(0, 4000)}\n\n… preview truncated (${args.content.length.toLocaleString()} chars total)`
          : args.content

      const existingNote =
        existingPreview.length > 0
          ? `\n\n--- current content (first 4,000 chars) ---\n${existingPreview}`
          : ''
      const checkpointNote = checkpoints
        ? `\n\nA bounded local restore point will be kept in Mike Assist app data before this change (up to ${MAX_CHECKPOINT_FILE_BYTES / 1024 / 1024} MB per file).`
        : ''

      return `${header}\n\n--- proposed content ---\n${body}${existingNote}${checkpointNote}`
    },
    async run(args, ctx) {
      const { path: target, grant, relative } = pathContext(ctx)

      if (ctx.signal.aborted) {
        throw new ToolError('The write was cancelled before it started.')
      }

      const beforeContent = checkpoints ? await readCheckpointableFile(target) : null
      const created = checkpoints ? beforeContent === null : !(await fileExists(target))
      const afterContent = Buffer.from(args.content, 'utf8')
      const previewKey = checkpointPreviewKey(grant.id, relative, args.content)
      if (checkpoints && previewHashes.has(previewKey)) {
        const approvedHash = previewHashes.get(previewKey) ?? null
        previewHashes.delete(previewKey)
        if (checkpointHash(beforeContent) !== approvedHash) {
          throw new ToolError('The file changed after you reviewed the write. No change was made; review the latest file state and try again.')
        }
      }
      const checkpoint = checkpoints?.create({
        grantId: grant.id,
        relativePath: relative,
        beforeContent,
        afterContent
      })

      const temporary = path.join(path.dirname(target), `.${path.basename(target)}.${randomUUID()}.tmp`)
      try {
        await mkdir(path.dirname(target), { recursive: true })
        await writeFile(temporary, afterContent, { flag: 'wx' })
        if (ctx.signal.aborted) {
          throw new ToolError('The write was cancelled before it could be committed.')
        }
        if (checkpoints) {
          const current = await readCheckpointableFile(target)
          if (checkpointHash(current) !== checkpointHash(beforeContent)) {
            throw new ToolError('The file changed after approval. No write was made; review the new file state and try again.')
          }
        }
        await rename(temporary, target)
      } catch (error) {
        await unlink(temporary).catch(() => undefined)
        if (checkpoint) checkpoints?.remove(checkpoint.id)
        if ((error as NodeJS.ErrnoException).code === 'EISDIR') {
          throw new ToolError('That path is a directory, not a file.')
        }
        throw error
      }

      return {
        root: grant.label,
        path: relative,
        bytes: afterContent.byteLength,
        created,
        ...(checkpoint ? { checkpointId: checkpoint.id } : {})
      }
    }
  }
}

function checkpointPreviewKey(grantId: string, relativePath: string, content: string): string {
  return JSON.stringify([grantId, relativePath, content])
}

export const writeFileTool = createWriteFileTool()

interface CheckpointListOutput {
  root: string
  path: string
  checkpoints: Array<{
    id: string
    createdAt: string
    beforeExists: boolean
    beforeBytes: number
    afterExists: boolean
    afterSha256: string | null
  }>
}

export function createFileCheckpointTools(store: FileCheckpointStore): ToolDef<any, any>[] {
  const list: ToolDef<{ root?: string; path: string; limit?: number }, CheckpointListOutput> = {
    name: 'list_file_checkpoints',
    description: 'List recent assistant file-change restore points for one path inside an approved folder.',
    risk: 'read',
    input: z.object({ root: rootField, path: z.string(), limit: z.number().int().min(1).max(10).optional() }),
    async scope(args, ctx) {
      const grant = ctx.grants.get(args.root)
      const resolved = await resolveGrantPath(grant, args.path)
      return { kind: 'path', grantId: grant.id, grantLabel: grant.label, path: resolved.path, relative: resolved.relative }
    },
    run: async (args, ctx) => {
      const { grant, relative } = pathContext(ctx)
      return {
        root: grant.label,
        path: relative,
        checkpoints: store.list(grant.id, relative, args.limit).map(({ id, createdAt, beforeExists, beforeBytes, afterExists, afterSha256 }) => ({
          id, createdAt, beforeExists, beforeBytes, afterExists, afterSha256
        }))
      }
    }
  }

  const restore: ToolDef<{ root?: string; path: string; checkpointId: string }, { root: string; path: string; removed: boolean; checkpointId: string }> = {
    name: 'restore_file_checkpoint',
    description: 'Restore the exact state recorded before an assistant file change. This is reversible and requires one-time approval; restoration is refused if the file changed since that checkpoint.',
    risk: 'write',
    sessionApprovalAllowed: false,
    input: z.object({ root: rootField, path: z.string(), checkpointId: z.string().uuid() }),
    async scope(args, ctx) {
      const grant = ctx.grants.get(args.root)
      const resolved = await resolveGrantPath(grant, args.path)
      return { kind: 'path', grantId: grant.id, grantLabel: grant.label, path: resolved.path, relative: resolved.relative }
    },
    async preview(args, ctx) {
      const { path: target, grant, relative } = pathContext(ctx)
      const checkpoint = store.get(args.checkpointId, grant.id, relative)
      const current = await readCheckpointableFile(target)
      const unchanged = checkpointHash(current) === checkpoint.afterSha256 && (current !== null) === checkpoint.afterExists
      const restorePreview = textPreview(checkpoint.beforeContent)
      const targetState = checkpoint.beforeExists
        ? `Restore ${checkpoint.beforeBytes.toLocaleString()} bytes from ${new Date(checkpoint.createdAt).toLocaleString()}.`
        : `Remove this assistant-created file from ${new Date(checkpoint.createdAt).toLocaleString()}.`
      return [
        `${grant.label}/${relative}`,
        targetState,
        unchanged ? 'The current file still matches that restore point.' : 'The file has changed since this restore point; restoration will be blocked.',
        `SHA-256 after recorded change: ${checkpoint.afterSha256 ?? '(file absent)'}`,
        restorePreview
      ].join('\n\n')
    },
    async run(args, ctx) {
      const { path: target, grant, relative } = pathContext(ctx)
      const checkpoint = store.get(args.checkpointId, grant.id, relative)
      const current = await readCheckpointableFile(target)
      if ((current !== null) !== checkpoint.afterExists || checkpointHash(current) !== checkpoint.afterSha256) {
        throw new ToolError('The file changed since this restore point. No change was made.')
      }

      const beforeRestore = store.create({
        grantId: grant.id,
        relativePath: relative,
        beforeContent: current,
        afterContent: checkpoint.beforeContent
      })

      try {
        const stillCurrent = await readCheckpointableFile(target)
        if ((stillCurrent !== null) !== checkpoint.afterExists || checkpointHash(stillCurrent) !== checkpoint.afterSha256) {
          throw new ToolError('The file changed while restoration was preparing. No change was made.')
        }
        if (checkpoint.beforeExists) {
          if (!checkpoint.beforeContent) throw new ToolError('The restore point has no saved file content.')
          await writeFileAtomically(target, Buffer.from(checkpoint.beforeContent), ctx.signal)
        } else {
          if (ctx.signal.aborted) throw new ToolError('Restoration was cancelled before it started.')
          await unlink(target)
        }
      } catch (error) {
        store.remove(beforeRestore.id)
        throw error
      }

      return { root: grant.label, path: relative, removed: !checkpoint.beforeExists, checkpointId: beforeRestore.id }
    }
  }

  return [list, restore]
}

async function fileExists(target: string): Promise<boolean> {
  try {
    const info = await stat(target)
    if (info.isDirectory()) throw new ToolError('That path is a directory, not a file.')
    if (!info.isFile()) throw new ToolError('That path is not a regular file.')
    return true
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false
    throw error
  }
}

async function readCheckpointableFile(target: string): Promise<Buffer | null> {
  try {
    const info = await stat(target)
    if (info.isDirectory()) throw new ToolError('That path is a directory, not a file.')
    if (!info.isFile()) throw new ToolError('That path is not a regular file.')
    if (info.size > MAX_CHECKPOINT_FILE_BYTES) {
      throw new ToolError(`The file is larger than the ${MAX_CHECKPOINT_FILE_BYTES / 1024 / 1024} MB restore-point limit; no change was made.`)
    }
    const content = await readFile(target)
    if (content.byteLength !== info.size) throw new ToolError('The file changed while its restore point was being read. Try again.')
    return content
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw error
  }
}

async function writeFileAtomically(target: string, content: Uint8Array, signal: AbortSignal): Promise<void> {
  const temporary = path.join(path.dirname(target), `.${path.basename(target)}.${randomUUID()}.tmp`)
  try {
    await writeFile(temporary, content, { flag: 'wx' })
    if (signal.aborted) throw new ToolError('Restoration was cancelled before it could be committed.')
    await rename(temporary, target)
  } catch (error) {
    await unlink(temporary).catch(() => undefined)
    throw error
  }
}

function textPreview(content: Uint8Array | null): string {
  if (content === null) return 'Previous state: file did not exist.'
  const buffer = Buffer.from(content)
  if (buffer.includes(0)) return `Previous state is binary data (${buffer.byteLength.toLocaleString()} bytes).`
  const text = buffer.toString('utf8')
  const excerpt = text.slice(0, 2000)
  return `--- restored content preview ---\n${excerpt}${text.length > excerpt.length ? '\n… preview truncated' : ''}`
}

export const fsTools = [listDirTool, readFileTool, writeFileTool]
