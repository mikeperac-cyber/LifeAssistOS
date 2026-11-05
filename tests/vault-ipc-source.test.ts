import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import type { IpcMain } from 'electron'
import { afterEach, describe, expect, it } from 'vitest'
import { VaultStore } from '../src/core/vault'
import { registerDomainIpcHandlers } from '../src/main/ipc/domain-handlers'

let directory = ''

afterEach(async () => {
  if (directory) await rm(directory, { recursive: true, force: true })
  directory = ''
})

describe('vault source IPC validation', () => {
  it('stores cloud-file provenance and rejects unsupported source types', async () => {
    directory = await mkdtemp(path.join(tmpdir(), 'mike-assist-vault-source-'))
    const vault = new VaultStore(path.join(directory, 'vault.sqlite'))
    await vault.init()
    const handlers = new Map<string, Function>()
    const ipcMain = {
      handle: (channel: string, handler: Function) => handlers.set(channel, handler)
    } as unknown as IpcMain

    registerDomainIpcHandlers({
      ipcMain,
      getGateway: () => null,
      getResearch: () => null,
      getVault: () => vault,
      getPlanning: () => null,
      getCoaching: () => null,
      getWorkflows: () => null,
      getScheduledTasks: () => null,
      getScheduledTaskScheduler: () => null,
      getSkills: () => null,
      appendAuditAfterMutation: async () => true,
      hasRunningAssistantTask: () => false,
      setDirectToolBusy: () => undefined,
      errorMessage: (error) => error instanceof Error ? error.message : String(error)
    })

    try {
      const createDocument = handlers.get('assist:vault-create')
      expect(createDocument).toBeDefined()
      const invalid = await createDocument!({}, { title: 'Bad source', body: 'text', sourceType: 'unexpected' }) as { ok: boolean }
      expect(invalid.ok).toBe(false)
      expect(vault.list()).toHaveLength(0)

      const valid = await createDocument!({}, {
        title: 'Cloud excerpt', body: 'Approved text', sourceType: 'cloud_file', sourceRef: 'google_drive:file-123'
      }) as { ok: boolean; document?: { sourceType: string; sourceRef?: string } }
      expect(valid).toMatchObject({
        ok: true,
        document: { sourceType: 'cloud_file', sourceRef: 'google_drive:file-123' }
      })
      expect(vault.list()).toHaveLength(1)
    } finally {
      vault.close()
    }
  })
})
