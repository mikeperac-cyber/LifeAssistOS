import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createBackupSnapshot, restoreBackupSnapshot, verifyBackupSnapshot } from '../src/core/backup'
import { AuditLog } from '../src/core/audit/log'
import { ConversationStore } from '../src/core/conversations'
import { FinanceStore } from '../src/core/finance'
import { MemoryStore } from '../src/core/memory'
import { ResearchStore } from '../src/core/research'
import { VaultStore } from '../src/core/vault'
import { PlanningStore } from '../src/core/planning'
import { CoachingStore } from '../src/core/coaching'
import { FileCheckpointStore } from '../src/core/file-checkpoints'

let dir = ''
let source = ''
let backupRoot = ''
let conversations: ConversationStore
let finance: FinanceStore
let memory: MemoryStore

beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'mike-assist-backup-'))
  source = path.join(dir, 'user-data')
  backupRoot = path.join(dir, 'backups')
  await mkdir(source, { recursive: true })
  await mkdir(backupRoot)
  for (const name of ['settings.json', 'grants.json', 'allowed-domains.json', 'speech.json', 'workflows.json', 'skills.json', 'web-search.json', 'google-calendar.json', 'google-gmail.json', 'google-drive.json', 'scheduled-tasks.json']) {
    await writeFile(path.join(source, name), '{}\n', 'utf8')
  }
  const audit = new AuditLog(path.join(source, 'audit'), 'backup-test')
  await audit.init()
  await audit.append({ type: 'chat.message', data: { role: 'user', chars: 3 } })
  conversations = new ConversationStore(path.join(source, 'conversations.sqlite'))
  await conversations.init()
  const sessionId = conversations.activeSessionId()!
  conversations.appendMessage(sessionId, {
    id: 'backup-chat',
    role: 'user',
    text: 'persisted local text',
    at: new Date().toISOString()
  })
  finance = new FinanceStore(path.join(source, 'finance.sqlite'))
  await finance.init()
  finance.add({ direction: 'income', amount: '12.34', currency: 'USD', category: 'salary' })
  memory = new MemoryStore(path.join(source, 'memory.sqlite'))
  await memory.init()
  memory.add({ text: 'Mike teaches in Denizli', scope: 'teaching' })
})

afterEach(async () => {
  conversations.close()
  finance.close()
  memory.close()
  await rm(dir, { recursive: true, force: true })
})

describe('backup snapshot', () => {
  it('copies settings, allowlist, audit, manifest, and a consistent SQLite backup', async () => {
    const target = path.join(backupRoot, 'Mike Assist Backup test')
    await createBackupSnapshot(source, target, conversations, finance, memory, '0.1.0')

    expect(await readFile(path.join(target, 'settings.json'), 'utf8')).toBe('{}\n')
    expect(await readFile(path.join(target, 'web-search.json'), 'utf8')).toBe('{}\n')
    expect(await readFile(path.join(target, 'google-calendar.json'), 'utf8')).toBe('{}\n')
    expect(await readFile(path.join(target, 'google-gmail.json'), 'utf8')).toBe('{}\n')
    expect(await readFile(path.join(target, 'google-drive.json'), 'utf8')).toBe('{}\n')
    expect(await readFile(path.join(target, 'scheduled-tasks.json'), 'utf8')).toBe('{}\n')
    expect(await readFile(path.join(target, 'speech.json'), 'utf8')).toBe('{}\n')
    expect(await readFile(path.join(target, 'skills.json'), 'utf8')).toBe('{}\n')
    const auditFile = `${new Date().toISOString().slice(0, 7)}.jsonl`
    expect(await readFile(path.join(target, 'audit', auditFile), 'utf8')).toContain('chat.message')
    expect(JSON.parse(await readFile(path.join(target, 'manifest.json'), 'utf8'))).toMatchObject({
      formatVersion: 1,
      appVersion: '0.1.0',
      includes: expect.arrayContaining(['web-search.json', 'google-calendar.json', 'google-gmail.json', 'google-drive.json', 'skills.json', 'scheduled-tasks.json'])
    })

    const backup = new ConversationStore(path.join(target, 'conversations.sqlite'))
    await backup.init()
    expect(backup.getMessages(backup.activeSessionId()!)[0].text).toBe('persisted local text')
    backup.close()
    const backupFinance = new FinanceStore(path.join(target, 'finance.sqlite'))
    await backupFinance.init()
    expect(backupFinance.report('month').totals[0].incomeMinor).toBe(1234)
    backupFinance.close()
    const backupMemory = new MemoryStore(path.join(target, 'memory.sqlite'))
    await backupMemory.init()
    expect(backupMemory.recall('denizli')[0]?.text).toBe('Mike teaches in Denizli')
    backupMemory.close()
  })

  it('refuses to write the backup inside the application data tree', async () => {
    await expect(
      createBackupSnapshot(source, path.join(source, 'nested-backup'), conversations, finance, memory, '0.1.0')
    ).rejects.toThrow(/outside Mike Assist app data/)
  })

  it('removes only its incomplete destination if a copy fails', async () => {
    const target = path.join(backupRoot, 'incomplete')
    await rm(path.join(source, 'settings.json'))

    await expect(createBackupSnapshot(source, target, conversations, finance, memory, '0.1.0')).rejects.toBeTruthy()
    await expect(readFile(path.join(target, 'manifest.json'), 'utf8')).rejects.toMatchObject({
      code: 'ENOENT'
    })
  })

  it('includes Research, Vault, Plans, and Coaching databases when they are configured', async () => {
    const research = new ResearchStore(path.join(source, 'research.sqlite'))
    const vault = new VaultStore(path.join(source, 'vault.sqlite'))
    const planning = new PlanningStore(path.join(source, 'planning.sqlite'))
    const coaching = new CoachingStore(path.join(source, 'coaching.sqlite'))
    const fileCheckpoints = new FileCheckpointStore(path.join(source, 'file-checkpoints.sqlite'))
    await research.init()
    await vault.init()
    await planning.init()
    await coaching.init()
    await fileCheckpoints.init()
    research.create({ title: 'Backup test', question: 'Does this persist?' })
    vault.create({ title: 'Backup note', body: 'Persistent vault content.' })
    planning.capture('Backup inbox item')
    coaching.createGoal({ area: 'personal', title: 'Backup coaching goal' })
    const checkpoint = fileCheckpoints.create({
      grantId: 'backup-grant',
      relativePath: 'src/app.ts',
      beforeContent: Buffer.from('previous source'),
      afterContent: Buffer.from('assistant source')
    })

    const target = path.join(backupRoot, 'with-command-center')
    await createBackupSnapshot(source, target, conversations, finance, memory, '0.1.0', { research, vault, planning, coaching, fileCheckpoints })
    expect(await readFile(path.join(target, 'research.sqlite'))).toBeTruthy()
    expect(await readFile(path.join(target, 'vault.sqlite'))).toBeTruthy()
    expect(await readFile(path.join(target, 'planning.sqlite'))).toBeTruthy()
    expect(await readFile(path.join(target, 'coaching.sqlite'))).toBeTruthy()
    expect(await readFile(path.join(target, 'file-checkpoints.sqlite'))).toBeTruthy()
    expect(JSON.parse(await readFile(path.join(target, 'manifest.json'), 'utf8')).includes).toEqual(expect.arrayContaining(['research.sqlite', 'vault.sqlite', 'planning.sqlite', 'coaching.sqlite', 'file-checkpoints.sqlite']))

    const backupCheckpoints = new FileCheckpointStore(path.join(target, 'file-checkpoints.sqlite'))
    await backupCheckpoints.init()
    const restoredCheckpoint = backupCheckpoints.get(checkpoint.id, 'backup-grant', 'src/app.ts')
    expect(restoredCheckpoint.beforeExists).toBe(true)
    expect(Buffer.from(restoredCheckpoint.beforeContent ?? []).toString('utf8')).toBe('previous source')

    research.close()
    vault.close()
    planning.close()
    coaching.close()
    backupCheckpoints.close()
    fileCheckpoints.close()
  })

  it('verifies a valid backup snapshot and rejects a backup with a missing file or broken audit chain', async () => {
    const target = path.join(backupRoot, 'verify-test')
    await createBackupSnapshot(source, target, conversations, finance, memory, '0.1.0')

    const validResult = await verifyBackupSnapshot(target)
    expect(validResult.valid).toBe(true)
    expect(validResult.encrypted).toBe(false)
    expect(validResult.appVersion).toBe('0.1.0')

    await rm(path.join(target, 'finance.sqlite'))
    const missingResult = await verifyBackupSnapshot(target)
    expect(missingResult.valid).toBe(false)
    expect(missingResult.error).toMatch(/finance\.sqlite/i)
  })

  it('restores a backup snapshot over modified app data and cleans up WAL state', async () => {
    const target = path.join(backupRoot, 'restore-test')
    await createBackupSnapshot(source, target, conversations, finance, memory, '0.1.0')

    // Mutate current stores after the backup was taken
    const sessionId = conversations.activeSessionId()!
    conversations.appendMessage(sessionId, {
      id: 'post-backup-msg',
      role: 'user',
      text: 'This message was added after the backup',
      at: new Date().toISOString()
    })
    memory.add({ text: 'Post-backup fact that should disappear on restore', scope: 'general' })
    await writeFile(path.join(source, 'settings.json'), '{"mutated":true}\n', 'utf8')

    await restoreBackupSnapshot(target, source, {
      closeStores: () => {
        conversations.close()
        finance.close()
        memory.close()
      },
      reopenStores: async () => {
        await conversations.init()
        await finance.init()
        await memory.init()
      }
    })

    expect(await readFile(path.join(source, 'settings.json'), 'utf8')).toBe('{}\n')
    expect(conversations.getMessages(conversations.activeSessionId()!).map((m) => m.text)).toEqual([
      'persisted local text'
    ])
    expect(memory.recall('disappear')).toEqual([])
    expect(memory.recall('denizli')[0]?.text).toBe('Mike teaches in Denizli')
  })

  it('creates, verifies, and restores a passphrase-encrypted backup snapshot', async () => {
    const target = path.join(backupRoot, 'encrypted-backup')
    await createBackupSnapshot(source, target, conversations, finance, memory, '0.1.0', {
      passphrase: 'correct-horse-battery-staple'
    })

    const withoutPassphrase = await verifyBackupSnapshot(target)
    expect(withoutPassphrase.valid).toBe(false)
    expect(withoutPassphrase.encrypted).toBe(true)

    const wrongPassphrase = await verifyBackupSnapshot(target, { passphrase: 'wrong-password' })
    expect(wrongPassphrase.valid).toBe(false)

    const rightPassphrase = await verifyBackupSnapshot(target, {
      passphrase: 'correct-horse-battery-staple'
    })
    expect(rightPassphrase.valid).toBe(true)
    expect(rightPassphrase.encrypted).toBe(true)

    // Mutate data and restore from the encrypted backup
    await writeFile(path.join(source, 'settings.json'), '{"tampered":true}\n', 'utf8')
    await restoreBackupSnapshot(target, source, {
      passphrase: 'correct-horse-battery-staple',
      closeStores: () => {
        conversations.close()
        finance.close()
        memory.close()
      },
      reopenStores: async () => {
        await conversations.init()
        await finance.init()
        await memory.init()
      }
    })

    expect(await readFile(path.join(source, 'settings.json'), 'utf8')).toBe('{}\n')
    expect(conversations.getMessages(conversations.activeSessionId()!)[0].text).toBe(
      'persisted local text'
    )
    expect(finance.report('month').recent).toHaveLength(1)
    expect(memory.list()).toHaveLength(1)
  })
})
