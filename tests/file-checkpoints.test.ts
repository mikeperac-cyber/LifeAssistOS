import { mkdir, mkdtemp, open, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { afterEach, describe, expect, it } from 'vitest'
import { AuditLog } from '../src/core/audit/log'
import { FileCheckpointStore, MAX_CHECKPOINT_FILE_BYTES } from '../src/core/file-checkpoints'
import { Gateway } from '../src/core/gateway/gateway'
import { defaultPolicy } from '../src/core/gateway/policy'
import { GrantStore } from '../src/core/grants'
import { ToolRegistry } from '../src/core/registry'
import type { PermissionRequest } from '../src/shared/types'
import { createFileCheckpointTools, createWriteFileTool } from '../src/tools/fs'

const cleanup: Array<() => Promise<void>> = []

afterEach(async () => {
  for (const close of cleanup.splice(0)) await close()
})

async function harness(beforeApproval?: (request: PermissionRequest) => Promise<void>): Promise<{
  root: string
  gateway: Gateway
  checkpoints: FileCheckpointStore
  approvals: PermissionRequest[]
  grantId: string
}> {
  const directory = await mkdtemp(path.join(tmpdir(), 'mike-assist-checkpoints-'))
  const root = await realpath(await mkdtemp(path.join(directory, 'approved-')))
  const userData = path.join(directory, 'user-data')
  const auditDir = path.join(userData, 'audit')
  await mkdir(auditDir, { recursive: true })

  const grants = new GrantStore(path.join(userData, 'grants.json'))
  await grants.init(root)
  const audit = new AuditLog(auditDir, 'checkpoint-test')
  await audit.init()
  const checkpoints = new FileCheckpointStore(path.join(userData, 'file-checkpoints.sqlite'))
  await checkpoints.init()

  const registry = new ToolRegistry()
  registry.register(createWriteFileTool(checkpoints))
  for (const tool of createFileCheckpointTools(checkpoints)) registry.register(tool)
  const approvals: PermissionRequest[] = []
  const gateway = new Gateway({
    registry,
    policy: defaultPolicy,
    audit,
    grants,
    approve: async (request) => {
      approvals.push(request)
      await beforeApproval?.(request)
      return true
    }
  })

  cleanup.push(async () => {
    checkpoints.close()
    await rm(directory, { recursive: true, force: true })
  })
  return { root, gateway, checkpoints, approvals, grantId: grants.primary().id }
}

describe('assistant file restore points', () => {
  it('preserves the original SQLite error when checkpoint insertion already rolled back', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'mike-assist-checkpoint-rollback-'))
    const file = path.join(directory, 'file-checkpoints.sqlite')
    const checkpoints = new FileCheckpointStore(file)
    await checkpoints.init()
    const fault = new DatabaseSync(file)
    fault.exec(`
      CREATE TRIGGER fail_checkpoint_insert BEFORE INSERT ON file_checkpoints BEGIN
        SELECT RAISE(ROLLBACK, 'forced checkpoint insert failure');
      END;
    `)

    try {
      expect(() => checkpoints.create({
        grantId: 'grant',
        relativePath: 'notes.txt',
        beforeContent: Buffer.from('before'),
        afterContent: Buffer.from('after')
      })).toThrow(/forced checkpoint insert failure/)
    } finally {
      fault.exec('DROP TRIGGER fail_checkpoint_insert')
      fault.close()
      checkpoints.close()
      await rm(directory, { recursive: true, force: true })
    }
  })

  it('restores an overwritten file and can redo the change', async () => {
    const { root, gateway, approvals } = await harness()
    const target = path.join(root, 'src', 'app.ts')
    await mkdir(path.dirname(target), { recursive: true })
    await writeFile(target, 'const version = "original";\n')

    const write = await gateway.execute({
      id: 'write-1',
      name: 'write_file',
      args: { path: 'src/app.ts', content: 'const version = "assistant";\n' }
    })
    expect(write.ok).toBe(true)
    const firstCheckpointId = (write.output as { checkpointId: string }).checkpointId
    expect(await readFile(target, 'utf8')).toBe('const version = "assistant";\n')

    const listed = await gateway.execute({
      id: 'list-1',
      name: 'list_file_checkpoints',
      args: { path: 'src/app.ts' }
    })
    expect(listed.ok).toBe(true)
    expect((listed.output as { checkpoints: Array<{ id: string }> }).checkpoints[0]?.id).toBe(firstCheckpointId)

    const undo = await gateway.execute({
      id: 'restore-1',
      name: 'restore_file_checkpoint',
      args: { path: 'src/app.ts', checkpointId: firstCheckpointId }
    })
    expect(undo.ok).toBe(true)
    expect(undo.output).toMatchObject({ removed: false })
    expect(await readFile(target, 'utf8')).toBe('const version = "original";\n')
    const restoreApproval = approvals.find((request) => request.callId === 'restore-1')
    expect(restoreApproval).toMatchObject({ risk: 'write', sessionApprovalAllowed: false })
    expect(restoreApproval?.preview).toContain('const version = "original";')
    const redoCheckpointId = (undo.output as { checkpointId: string }).checkpointId

    const redo = await gateway.execute({
      id: 'restore-2',
      name: 'restore_file_checkpoint',
      args: { path: 'src/app.ts', checkpointId: redoCheckpointId }
    })
    expect(redo.ok).toBe(true)
    expect(await readFile(target, 'utf8')).toBe('const version = "assistant";\n')
  })

  it('removes a newly created assistant file and can restore it again', async () => {
    const { root, gateway } = await harness()
    const target = path.join(root, 'new-file.md')
    const write = await gateway.execute({
      id: 'write-new',
      name: 'write_file',
      args: { path: 'new-file.md', content: '# Assistant-created note\n' }
    })
    const checkpointId = (write.output as { checkpointId: string }).checkpointId

    const undo = await gateway.execute({
      id: 'remove-new',
      name: 'restore_file_checkpoint',
      args: { path: 'new-file.md', checkpointId }
    })
    expect(undo.ok).toBe(true)
    expect(undo.output).toMatchObject({ removed: true })
    await expect(readFile(target, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })

    const restoreCreated = await gateway.execute({
      id: 'restore-created',
      name: 'restore_file_checkpoint',
      args: { path: 'new-file.md', checkpointId: (undo.output as { checkpointId: string }).checkpointId }
    })
    expect(restoreCreated.ok).toBe(true)
    expect(await readFile(target, 'utf8')).toBe('# Assistant-created note\n')
  })

  it('restores an empty existing file without confusing it with a missing file', async () => {
    const { root, gateway } = await harness()
    const target = path.join(root, 'empty.txt')
    await writeFile(target, '')
    const write = await gateway.execute({
      id: 'write-empty',
      name: 'write_file',
      args: { path: 'empty.txt', content: 'temporary contents' }
    })
    const checkpointId = (write.output as { checkpointId: string }).checkpointId

    const restore = await gateway.execute({
      id: 'restore-empty',
      name: 'restore_file_checkpoint',
      args: { path: 'empty.txt', checkpointId }
    })
    expect(restore.ok).toBe(true)
    expect((restore.output as { removed: boolean }).removed).toBe(false)
    expect(await readFile(target, 'utf8')).toBe('')
  })

  it('refuses to restore over a file that changed after the checkpoint', async () => {
    const { root, gateway } = await harness()
    const target = path.join(root, 'notes.md')
    await writeFile(target, 'before')
    const write = await gateway.execute({
      id: 'write-stale',
      name: 'write_file',
      args: { path: 'notes.md', content: 'assistant version' }
    })
    const checkpointId = (write.output as { checkpointId: string }).checkpointId
    await writeFile(target, 'user changed this after approval')

    const restore = await gateway.execute({
      id: 'restore-stale',
      name: 'restore_file_checkpoint',
      args: { path: 'notes.md', checkpointId }
    })
    expect(restore.ok).toBe(false)
    expect(restore.error).toContain('changed since this restore point')
    expect(await readFile(target, 'utf8')).toBe('user changed this after approval')
  })

  it('refuses to overwrite a file changed while its approval is open', async () => {
    let target = ''
    const { root, gateway, checkpoints, grantId } = await harness(async (request) => {
      if (request.tool === 'write_file') await writeFile(target, 'changed while approval was open')
    })
    target = path.join(root, 'racing.md')
    await writeFile(target, 'original state')

    const result = await gateway.execute({
      id: 'write-race',
      name: 'write_file',
      args: { path: 'racing.md', content: 'assistant state' }
    })
    expect(result.ok).toBe(false)
    expect(result.error).toContain('changed after you reviewed')
    expect(await readFile(target, 'utf8')).toBe('changed while approval was open')
    expect(checkpoints.list(grantId, 'racing.md')).toHaveLength(0)
  })

  it('blocks a write whose existing file cannot fit in bounded checkpoint storage', async () => {
    const { root, gateway } = await harness()
    const target = path.join(root, 'large.txt')
    const handle = await open(target, 'w')
    await handle.truncate(MAX_CHECKPOINT_FILE_BYTES + 1)
    await handle.close()

    const result = await gateway.execute({
      id: 'write-large',
      name: 'write_file',
      args: { path: 'large.txt', content: 'replacement' }
    })
    expect(result.ok).toBe(false)
    expect(result.error).toContain('restore-point limit')
    expect((await readFile(target)).byteLength).toBe(MAX_CHECKPOINT_FILE_BYTES + 1)
  }, 15_000)
})
