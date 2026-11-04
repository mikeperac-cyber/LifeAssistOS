import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { AuditLog } from '../src/core/audit/log'
import { DomainAllowlistStore } from '../src/core/domain-allowlist'
import { Gateway } from '../src/core/gateway/gateway'
import { defaultPolicy } from '../src/core/gateway/policy'
import { GrantStore } from '../src/core/grants'
import { ToolRegistry } from '../src/core/registry'
import type { ToolCall } from '../src/shared/types'
import { noteTools } from '../src/tools/notes'
import { projectOverviewTool } from '../src/tools/project'
import { createWebFetchTool, validateUrl } from '../src/tools/web'

let root = ''
let dataDir = ''
let grants: GrantStore
let audit: AuditLog
let gateway: Gateway
let sequence = 0

beforeEach(async () => {
  root = await realpath(await mkdtemp(path.join(tmpdir(), 'mike-assist-m3-root-')))
  dataDir = await mkdtemp(path.join(tmpdir(), 'mike-assist-m3-data-'))
  grants = new GrantStore(path.join(dataDir, 'grants.json'))
  await grants.init(root)
  audit = new AuditLog(path.join(dataDir, 'audit'), 'm3-test')
  await audit.init()

  const registry = new ToolRegistry()
  for (const tool of noteTools) registry.register(tool)
  gateway = new Gateway({
    registry,
    policy: defaultPolicy,
    audit,
    grants,
    approve: async () => true
  })
})

afterEach(async () => {
  await rm(root, { recursive: true, force: true })
  await rm(dataDir, { recursive: true, force: true })
})

function call(name: string, args: unknown): ToolCall {
  sequence += 1
  return { id: `m3-${sequence}`, name, args }
}

describe('local note tools', () => {
  it('creates an approved Markdown note and finds it by search', async () => {
    const created = await gateway.execute(
      call('create_note', {
        title: 'Photosynthesis Review',
        content: 'Chlorophyll absorbs light; the Calvin cycle fixes carbon.'
      })
    )

    expect(created.ok).toBe(true)
    expect(await readFile(path.join(root, 'notes', 'photosynthesis-review.md'), 'utf8')).toContain(
      '# Photosynthesis Review'
    )

    const found = await gateway.execute(call('search_notes', { query: 'Calvin cycle' }))
    expect(found.ok, found.error).toBe(true)
    expect((found.output as { hits: Array<{ path: string }> }).hits[0].path).toBe(
      'photosynthesis-review.md'
    )
  })

  it('keeps note paths inside notes/ and denies invalid traversal', async () => {
    const result = await gateway.execute(
      call('create_note', {
        title: 'Safe title',
        content: 'content',
        path: '../outside.md'
      })
    )

    expect(result.blocked).toBe(true)
    expect(await readFile(path.join(root, 'outside.md'), 'utf8').catch(() => null)).toBeNull()
  })
})

describe('project overview tool', () => {
  it('maps source and manifest files while excluding generated and hidden data', async () => {
    const project = path.join(root, 'Sample project')
    await mkdir(path.join(project, 'src'), { recursive: true })
    await mkdir(path.join(project, 'node_modules', 'dep'), { recursive: true })
    await mkdir(path.join(project, '.git'), { recursive: true })
    await mkdir(path.join(project, 'tests'), { recursive: true })
    await writeFile(path.join(project, 'package.json'), '{"scripts":{"test":"vitest"}}', 'utf8')
    await writeFile(path.join(project, 'README.md'), '# Sample project', 'utf8')
    await writeFile(path.join(project, 'src', 'index.ts'), 'export const answer = 42', 'utf8')
    await writeFile(path.join(project, 'tests', 'index.test.ts'), 'expect(true).toBe(true)', 'utf8')
    await writeFile(path.join(project, 'node_modules', 'dep', 'private.js'), 'ignored', 'utf8')
    await writeFile(path.join(project, '.env'), 'SECRET=value', 'utf8')
    await grants.add({ folderPath: project, access: 'read' })

    const registry = new ToolRegistry().register(projectOverviewTool)
    const projectGateway = new Gateway({ registry, policy: defaultPolicy, audit, grants, approve: async () => true })
    const result = await projectGateway.execute(call('project_overview', { root: 'Sample project' }))

    expect(result.ok).toBe(true)
    const output = result.output as {
      stack: string[]
      files: Array<{ path: string }>
      keyFiles: string[]
      fileCount: number
    }
    expect(output.stack).toContain('JavaScript/TypeScript')
    expect(output.keyFiles).toContain('package.json')
    expect(output.keyFiles).toContain('src\\index.ts')
    expect(output.files.some((file) => file.path.includes('node_modules'))).toBe(false)
    expect(output.files.some((file) => file.path.includes('.env'))).toBe(false)
    expect(output.fileCount).toBe(4)
  })

  it('surfaces repository instruction files while keeping unrelated hidden data out', async () => {
    const project = path.join(root, 'Guided project')
    await mkdir(path.join(project, '.github', 'instructions'), { recursive: true })
    await mkdir(path.join(project, '.cursor', 'rules'), { recursive: true })
    await writeFile(path.join(project, 'AGENTS.md'), 'Use the project formatter.', 'utf8')
    await writeFile(path.join(project, '.github', 'copilot-instructions.md'), 'Keep changes focused.', 'utf8')
    await writeFile(path.join(project, '.github', 'instructions', 'tests.instructions.md'), 'Use the test runner.', 'utf8')
    await writeFile(path.join(project, '.cursor', 'rules', 'typescript.md'), 'Prefer strict types.', 'utf8')
    await writeFile(path.join(project, '.env'), 'API_KEY=private', 'utf8')
    await writeFile(path.join(project, '.cursor', 'session.json'), '{"private":true}', 'utf8')
    await writeFile(path.join(project, 'package.json'), '{"name":"guided"}', 'utf8')
    await grants.add({ folderPath: project, access: 'read' })

    const registry = new ToolRegistry().register(projectOverviewTool)
    const projectGateway = new Gateway({ registry, policy: defaultPolicy, audit, grants, approve: async () => true })
    const result = await projectGateway.execute(call('project_overview', { root: 'Guided project' }))

    expect(result.ok, result.error).toBe(true)
    const output = result.output as {
      instructionFiles: string[]
      instructionFilesTruncated: boolean
      keyFiles: string[]
      files: Array<{ path: string; kind: string }>
    }
    expect(output.instructionFilesTruncated).toBe(false)
    expect(output.instructionFiles).toContain('AGENTS.md')
    expect(output.instructionFiles).toContain(path.join('.github', 'copilot-instructions.md'))
    expect(output.instructionFiles).toContain(path.join('.github', 'instructions', 'tests.instructions.md'))
    expect(output.instructionFiles).toContain(path.join('.cursor', 'rules', 'typescript.md'))
    expect(output.keyFiles.slice(0, output.instructionFiles.length)).toEqual(output.instructionFiles)
    expect(output.files.some((file) => file.path.endsWith('.env') || file.path.includes('session.json'))).toBe(false)
  })

  it('includes bounded PDF and Office files among review key files', async () => {
    const project = path.join(root, 'Business documents')
    await mkdir(project)
    await writeFile(path.join(project, 'contract.pdf'), Buffer.alloc(70_000, 65))
    await writeFile(path.join(project, 'forecast.xlsx'), Buffer.alloc(70_000, 66))
    await writeFile(path.join(project, 'proposal.docx'), Buffer.alloc(70_000, 67))
    await grants.add({ folderPath: project, access: 'read' })

    const registry = new ToolRegistry().register(projectOverviewTool)
    const projectGateway = new Gateway({ registry, policy: defaultPolicy, audit, grants, approve: async () => true })
    const result = await projectGateway.execute(call('project_overview', { root: 'Business documents' }))

    expect(result.ok, result.error).toBe(true)
    const output = result.output as { keyFiles: string[]; skippedLargeFiles: string[]; fileCount: number }
    expect(output.fileCount).toBe(3)
    expect(output.keyFiles).toEqual(['contract.pdf', 'forecast.xlsx', 'proposal.docx'])
    expect(output.skippedLargeFiles).toEqual([])
  })
})

describe('email and calendar draft tools', () => {
  it('writes a local unsent .eml file and never sends mail', async () => {
    const result = await gateway.execute(
      call('create_email_draft', {
        to: 'alex@example.com',
        subject: 'Meeting follow-up',
        body: 'Thanks for meeting today.'
      })
    )

    expect(result.ok).toBe(true)
    const draftPath = path.join(root, 'drafts', 'meeting-follow-up.eml')
    const draft = await readFile(draftPath, 'utf8')
    expect(draft).toContain('To: alex@example.com')
    expect(draft).toContain('X-Unsent: 1')
    expect(draft).toContain('Thanks for meeting today.')
  })

  it('rejects email header injection before writing', async () => {
    const result = await gateway.execute(
      call('create_email_draft', {
        to: 'alex@example.com\r\nBcc: attacker@example.net',
        subject: 'Hello',
        body: 'Body'
      })
    )

    expect(result.blocked).toBe(true)
    expect(await readFile(path.join(root, 'drafts', 'hello.eml'), 'utf8').catch(() => null)).toBeNull()
  })

  it('creates an .ics draft and rejects an end time before the start', async () => {
    const result = await gateway.execute(
      call('create_calendar_event', {
        title: 'Study group',
        startsAt: '2026-11-03T10:00:00Z',
        endsAt: '2026-11-03T11:00:00Z',
        description: 'Bring notes, chapters 8-10.'
      })
    )

    expect(result.ok).toBe(true)
    const calendarPath = path.join(root, 'calendar', 'study-group.ics')
    const calendar = await readFile(calendarPath, 'utf8')
    expect(calendar).toContain('BEGIN:VCALENDAR')
    expect(calendar).toContain('DTSTART:20261103T100000Z')
    expect(calendar).toContain('DTEND:20261103T110000Z')
    expect(calendar).toContain('Bring notes\\, chapters 8-10.')

    const invalid = await gateway.execute(
      call('create_calendar_event', {
        title: 'Backwards event',
        startsAt: '2026-11-03T11:00:00Z',
        endsAt: '2026-11-03T10:00:00Z'
      })
    )
    expect(invalid.blocked).toBe(true)
  })
})

describe('domain allowlist and web URL validation', () => {
  it('normalizes and persists exact public domains', async () => {
    const store = new DomainAllowlistStore(path.join(dataDir, 'domains.json'))
    await store.init()
    expect(await store.add('  Example.COM.  ')).toEqual(['example.com'])
    expect(store.allows('EXAMPLE.com')).toBe(true)
    expect(store.allows('sub.example.com')).toBe(false)

    const reloaded = new DomainAllowlistStore(path.join(dataDir, 'domains.json'))
    await reloaded.init()
    expect(reloaded.list()).toEqual(['example.com'])
    await expect(store.add('localhost')).rejects.toThrow(/public domain/i)
    await expect(store.add('127.0.0.1')).rejects.toThrow(/public domain/i)
    await expect(store.add('*.example.com')).rejects.toThrow(/public domain/i)
  })

  it('does not allow a domain in memory when saving it fails', async () => {
    const file = path.join(dataDir, 'domains.json')
    const store = new DomainAllowlistStore(file)
    await store.init()
    await rm(file)
    await mkdir(file)

    await expect(store.add('example.com')).rejects.toBeDefined()

    expect(store.allows('example.com')).toBe(false)
  })

  it('keeps a domain allowlisted when saving its removal fails', async () => {
    const file = path.join(dataDir, 'domains.json')
    const store = new DomainAllowlistStore(file)
    await store.init()
    await store.add('example.com')
    await rm(file)
    await mkdir(file)

    await expect(store.remove('example.com')).rejects.toBeDefined()

    expect(store.allows('example.com')).toBe(true)
  })

  it('permits only HTTPS on an exact allowlisted host', () => {
    expect(validateUrl('https://example.com/article#top', (host) => host === 'example.com').toString())
      .toBe('https://example.com/article')
    expect(() => validateUrl('http://example.com', () => true)).toThrow(/HTTPS/)
    expect(() => validateUrl('https://sub.example.com', (host) => host === 'example.com')).toThrow(/allowlisted/)
    expect(() => validateUrl('https://user:pass@example.com', () => true)).toThrow(/allowlisted/)
    expect(() => validateUrl('https://127.0.0.1', () => true)).toThrow(/allowlisted/)
  })

  it('declares external scope only when the host is allowlisted', async () => {
    const tool = createWebFetchTool((host) => host === 'example.com')
    const scope = await tool.scope?.(
      { url: 'https://example.com/news' },
      { grants, primaryGrantId: grants.primary().id }
    )
    expect(scope).toMatchObject({ kind: 'url', host: 'example.com' })

    expect(() =>
      tool.scope?.(
        { url: 'https://not-allowed.example/news' },
        { grants, primaryGrantId: grants.primary().id }
      )
    ).toThrow(/allowlisted/)
  })
})
