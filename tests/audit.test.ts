import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { AuditLog, verifyChain } from '../src/core/audit/log'
import type { AuditEvent } from '../src/shared/types'

let dir = ''

beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'mike-assist-audit-'))
})

afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

describe('AuditLog hash chain', () => {
  it('chains new events and verifies after a restart', async () => {
    const log = new AuditLog(dir, 'session-a')
    await log.init()
    const first = await log.append({ type: 'chat.message', data: { role: 'user', chars: 4 } })
    const second = await log.append({ type: 'call.proposed', data: { tool: 'read_file' } })

    expect(first.prevHash).toMatch(/^[a-f0-9]{64}$/)
    expect(first.hash).toMatch(/^[a-f0-9]{64}$/)
    expect(second.prevHash).toBe(first.hash)
    expect(log.getIntegrity()).toMatchObject({ valid: true, legacyEvents: 0, chainedEvents: 2 })
    expect(verifyChain(log.list()).valid).toBe(true)

    const reloaded = new AuditLog(dir, 'session-b')
    await reloaded.init()
    expect(reloaded.getIntegrity()).toMatchObject({ valid: true, chainedEvents: 2 })
    const third = await reloaded.append({ type: 'call.completed', data: { tool: 'read_file' } })
    expect(third.prevHash).toBe(second.hash)
    expect(reloaded.getIntegrity().chainedEvents).toBe(3)
  })

  it('anchors new events to the last legacy event without rewriting it', async () => {
    const legacy: AuditEvent = {
      id: 'legacy-1',
      at: '2025-01-01T00:00:00.000Z',
      sessionId: 'old-session',
      type: 'chat.message',
      data: { role: 'user', chars: 2 }
    }
    const file = path.join(dir, '2025-01.jsonl')
    await writeFile(file, `${JSON.stringify(legacy)}\n`, 'utf8')

    const log = new AuditLog(dir, 'current-session')
    await log.init()
    expect(log.getIntegrity()).toMatchObject({ valid: true, legacyEvents: 1, chainedEvents: 0 })

    const chained = await log.append({ type: 'agent.step', data: { step: 1 } })
    expect(chained.prevHash).toMatch(/^[a-f0-9]{64}$/)
    expect(log.getIntegrity()).toMatchObject({ valid: true, legacyEvents: 1, chainedEvents: 1 })
    expect((await readFile(file, 'utf8')).trim()).toBe(JSON.stringify(legacy))
  })

  it('detects tampering and refuses further appends', async () => {
    const log = new AuditLog(dir, 'session-a')
    await log.init()
    await log.append({ type: 'chat.message', data: { role: 'user', chars: 4 } })

    const file = path.join(dir, '2026-11.jsonl')
    const lines = (await readFile(file, 'utf8')).trim().split('\n')
    const event = JSON.parse(lines[0]) as AuditEvent
    event.data.chars = 99
    lines[0] = JSON.stringify(event)
    await writeFile(file, `${lines.join('\n')}\n`, 'utf8')

    const reloaded = new AuditLog(dir, 'session-b')
    await reloaded.init()
    expect(reloaded.getIntegrity()).toMatchObject({ valid: false, chainedEvents: 0 })
    await expect(reloaded.append({ type: 'call.proposed', data: { tool: 'write_file' } }))
      .rejects.toThrow(/integrity verification failed/i)
  })

  it('marks corrupt JSONL rows as an integrity issue', async () => {
    await writeFile(path.join(dir, '2026-11.jsonl'), '{bad json}\n', 'utf8')
    const log = new AuditLog(dir, 'session-a')
    await log.init()

    expect(log.getIntegrity().valid).toBe(false)
    await expect(log.append({ type: 'chat.message', data: { role: 'user', chars: 1 } }))
      .rejects.toThrow(/integrity verification failed/i)
  })

  it('rechecks integrity from disk when the same log instance is reopened', async () => {
    const file = path.join(dir, '2026-11.jsonl')
    await writeFile(file, '{bad json}\n', 'utf8')
    const log = new AuditLog(dir, 'session-a')
    await log.init()
    expect(log.getIntegrity().valid).toBe(false)

    await writeFile(file, '', 'utf8')
    await log.init()
    expect(log.getIntegrity().valid).toBe(true)
    await expect(log.append({ type: 'chat.message', data: { role: 'user', chars: 1 } })).resolves.toBeDefined()
  })
})
