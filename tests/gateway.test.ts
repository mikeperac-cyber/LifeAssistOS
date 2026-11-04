import { mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { z } from 'zod'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AuditLog } from '../src/core/audit/log'
import { Gateway, type ApprovalBroker } from '../src/core/gateway/gateway'
import { defaultPolicy, type PolicyConfig } from '../src/core/gateway/policy'
import { GrantStore } from '../src/core/grants'
import { SessionApprovalStore } from '../src/core/gateway/session-approvals'
import { ToolRegistry } from '../src/core/registry'
import type { AuditEvent, ToolCall, ToolContext, ToolDef } from '../src/shared/types'
import { fsTools, writeFileTool } from '../src/tools/fs'
import { resolveGrantPath } from '../src/tools/paths'

let root = ''
let outside = ''
let auditDir = ''
let audit: AuditLog
let grants: GrantStore
let sequence = 0

const testPolicy: PolicyConfig = {
  ...defaultPolicy,
  approvalTimeoutMs: 500,
  tools: {
    ...defaultPolicy.tools,
    echo: 'allow',
    danger: 'ask',
    scoped_read: 'allow',
    outside: 'allow',
    url_tool: 'allow',
    invalid: 'allow',
    hang: 'allow',
    boom: 'allow',
    wipe: 'allow',
    shell: 'allow',
    write_extra: 'ask',
    write_papers: 'ask'
  }
}

beforeEach(async () => {
  root = await realpath(await mkdtemp(path.join(tmpdir(), 'mike-assist-gw-root-')))
  outside = await realpath(await mkdtemp(path.join(tmpdir(), 'mike-assist-gw-outside-')))
  auditDir = await mkdtemp(path.join(tmpdir(), 'mike-assist-gw-audit-'))
  audit = new AuditLog(auditDir, 'test-session')
  await audit.init()

  grants = new GrantStore(path.join(auditDir, 'grants.json'))
  await grants.init(root)
})

afterEach(async () => {
  await rm(root, { recursive: true, force: true })
  await rm(outside, { recursive: true, force: true })
  await rm(auditDir, { recursive: true, force: true })
})

function call(name: string, args: unknown): ToolCall {
  sequence += 1
  return { id: `call-${sequence}`, name, args }
}

function registryWith(extra: Array<ToolDef<any, any>> = []): ToolRegistry {
  const registry = new ToolRegistry()

  registry.register({
    name: 'echo',
    description: 'Echo text',
    risk: 'read',
    input: z.object({ text: z.string() }),
    run: async (args: { text: string }) => ({ echoed: args.text })
  })

  registry.register({
    name: 'danger',
    description: 'A write that needs approval',
    risk: 'write',
    input: z.object({ value: z.number() }),
    preview: async (args: { value: number }) => `Will write value ${args.value}`,
    run: async (args: { value: number }) => ({ wrote: args.value })
  })

  registry.register({
    name: 'scoped_read',
    description: 'Reads inside the primary grant',
    risk: 'read',
    input: z.object({ path: z.string() }),
    scope: async (args, ctx) => {
      const grant = ctx.grants.primary()
      const resolved = await resolveGrantPath(grant, args.path)
      return {
        kind: 'path',
        grantId: grant.id,
        grantLabel: grant.label,
        path: resolved.path,
        relative: resolved.relative
      }
    },
    run: async (_args, ctx) => ({ resolved: ctx.kind === 'path' ? ctx.path : null })
  })

  registry.register({
    name: 'outside',
    description: 'Reports a scope outside the grant',
    risk: 'read',
    input: z.object({}),
    scope: () => ({
      kind: 'path',
      grantId: grants.primary().id,
      grantLabel: grants.primary().label,
      path: path.join(outside, 'elsewhere.txt'),
      relative: 'elsewhere.txt'
    }),
    run: async () => ({ reached: true })
  })

  registry.register({
    name: 'url_tool',
    description: 'Pretend to fetch a URL',
    risk: 'external',
    input: z.object({}),
    scope: () => ({ kind: 'url', host: 'example.com', url: 'https://example.com' }),
    run: async () => ({ fetched: true })
  })

  registry.register({
    name: 'invalid',
    description: 'Needs a string',
    risk: 'read',
    input: z.object({ name: z.string() }),
    run: async (args: { name: string }) => ({ name: args.name })
  })

  registry.register({
    name: 'hang',
    description: 'Never finishes',
    risk: 'read',
    input: z.object({}),
    run: () => new Promise(() => undefined)
  })

  registry.register({
    name: 'boom',
    description: 'Throws',
    risk: 'read',
    input: z.object({}),
    run: async () => {
      throw new Error('kaboom')
    }
  })

  registry.register({
    name: 'wipe',
    description: 'Destructive',
    risk: 'destructive',
    input: z.object({}),
    run: async () => ({ wiped: true })
  })

  registry.register({
    name: 'shell',
    description: 'Privileged',
    risk: 'privileged',
    input: z.object({}),
    run: async () => ({ shelled: true })
  })

  for (const tool of extra) registry.register(tool)
  return registry
}

function makeGateway(
  options: {
    policy?: PolicyConfig
    approve?: ApprovalBroker
    registry?: ToolRegistry
    toolTimeoutMs?: number
    log?: AuditLog
  } = {}
): Gateway {
  return new Gateway({
    registry: options.registry ?? registryWith(),
    policy: options.policy ?? testPolicy,
    audit: options.log ?? audit,
    grants,
    approve: options.approve ?? (() => Promise.resolve(true)),
    toolTimeoutMs: options.toolTimeoutMs ?? 1000
  })
}

describe('Gateway', () => {
  it('allows a read tool and records the full lifecycle', async () => {
    const result = await makeGateway().execute(call('echo', { text: 'hello' }))

    expect(result.ok).toBe(true)
    expect(result.output).toEqual({ echoed: 'hello' })
    expect(audit.list().map((event) => event.type)).toEqual([
      'call.proposed',
      'policy.decided',
      'call.started',
      'call.completed'
    ])
  })

  it('asks before a write and executes only after approval', async () => {
    const approvals: string[] = []
    const gateway = makeGateway({
      approve: async (request) => {
        approvals.push(request.tool)
        return true
      }
    })

    const result = await gateway.execute(call('danger', { value: 7 }))

    expect(approvals).toEqual(['danger'])
    expect(result.ok).toBe(true)
    expect(result.output).toEqual({ wrote: 7 })
    expect(audit.list().map((event) => event.type)).toContain('approval.granted')
  })

  it('surfaces and audits the external-content taint on a write approval', async () => {
    let tainted: boolean | undefined
    const gateway = makeGateway({
      approve: async (request) => {
        tainted = request.tainted
        return true
      }
    })
    const write = call('danger', { value: 5 })
    write.tainted = true

    const result = await gateway.execute(write)
    expect(result.ok).toBe(true)
    expect(tainted).toBe(true)
    expect(audit.list().find((event) => event.type === 'call.proposed')?.data.tainted).toBe(true)
  })

  it('remembers only an exact write approval inside its chat session', async () => {
    const approvals = new SessionApprovalStore()
    let sessionId = 'chat-a'
    const approve = vi.fn(async () => 'session' as const)
    const gateway = new Gateway({
      registry: registryWith(),
      policy: testPolicy,
      audit,
      grants,
      approve,
      sessionApprovals: approvals,
      sessionId: () => sessionId
    })

    const first = await gateway.execute(call('danger', { value: 1 }))
    const repeated = await gateway.execute(call('danger', { value: 1 }))
    const differentArguments = await gateway.execute(call('danger', { value: 2 }))
    sessionId = 'chat-b'
    const differentSession = await gateway.execute(call('danger', { value: 1 }))

    expect(first.ok && repeated.ok && differentArguments.ok && differentSession.ok).toBe(true)
    expect(approve).toHaveBeenCalledTimes(3)
    expect(audit.list().filter((event) => event.type === 'approval.session_granted')).toHaveLength(1)
  })

  it('does not execute a write when approval is denied', async () => {
    const run = vi.fn(async () => ({ wrote: true }))
    const registry = new ToolRegistry().register({
      name: 'danger',
      description: 'Write',
      risk: 'write',
      input: z.object({ value: z.number() }),
      preview: async () => 'preview',
      run
    })

    const result = await makeGateway({
      registry,
      approve: () => Promise.resolve(false)
    }).execute(call('danger', { value: 1 }))

    expect(result.ok).toBe(false)
    expect(result.denied).toBe(true)
    expect(run).not.toHaveBeenCalled()
    expect(audit.list().map((event) => event.type)).toContain('approval.denied')
  })

  it('denies when the approval broker ignores the abort signal', async () => {
    const gateway = makeGateway({
      policy: { ...testPolicy, approvalTimeoutMs: 30 },
      approve: () => new Promise<boolean>(() => undefined)
    })

    const started = Date.now()
    const result = await gateway.execute(call('danger', { value: 1 }))

    expect(result.denied).toBe(true)
    expect(result.error).toContain('timed out')
    expect(Date.now() - started).toBeLessThan(1000)
    expect(audit.list().map((event) => event.type)).toContain('approval.expired')
  })

  it('cancels a pending approval when the agent is stopped', async () => {
    const controller = new AbortController()
    const run = vi.fn(async () => ({ wrote: true }))
    const registry = new ToolRegistry().register({
      name: 'danger',
      description: 'Write',
      risk: 'write',
      input: z.object({ value: z.number() }),
      preview: async () => 'preview',
      run
    })
    const gateway = makeGateway({
      registry,
      approve: (_request, signal) =>
        new Promise<boolean>((resolve) => {
          signal.addEventListener('abort', () => resolve(false), { once: true })
        })
    })

    const pending = gateway.execute(call('danger', { value: 1 }), controller.signal)
    setTimeout(() => controller.abort(), 20)
    const result = await pending

    expect(result.denied).toBe(true)
    expect(result.error).toContain('cancelled')
    expect(run).not.toHaveBeenCalled()
    expect(audit.list().map((event) => event.type)).toContain('approval.cancelled')
  })

  it('cancels a running tool even when it ignores the abort signal', async () => {
    const controller = new AbortController()
    const pending = makeGateway().execute(call('hang', {}), controller.signal)
    setTimeout(() => controller.abort(), 20)

    const result = await pending

    expect(result.denied).toBe(true)
    expect(result.error).toContain('cancelled')
    expect(audit.list().map((event) => event.type)).toContain('call.cancelled')
  })

  it('blocks unknown tools', async () => {
    const result = await makeGateway().execute(call('nope', {}))
    expect(result.blocked).toBe(true)
    expect(result.error).toContain('Unknown tool')
  })

  it('blocks invalid arguments before execution', async () => {
    const result = await makeGateway().execute(call('invalid', { name: 42 }))
    expect(result.blocked).toBe(true)
    expect(result.error).toContain('Invalid arguments')
  })

  it('hard-blocks destructive and privileged risks even when policy says allow', async () => {
    const destructive = await makeGateway().execute(call('wipe', {}))
    expect(destructive.blocked).toBe(true)
    expect(destructive.error).toContain('hard-blocked')

    const privileged = await makeGateway().execute(call('shell', {}))
    expect(privileged.blocked).toBe(true)
    expect(privileged.error).toContain('hard-blocked')
  })

  it('blocks a tool whose scope is outside its grant', async () => {
    const result = await makeGateway().execute(call('outside', {}))
    expect(result.blocked).toBe(true)
    expect(result.error).toContain('outside the "Workspace" folder')
  })

  it('blocks network tools in this build', async () => {
    const result = await makeGateway().execute(call('url_tool', {}))
    expect(result.blocked).toBe(true)
    expect(result.error).toContain('External tools are not enabled')
  })

  it('allows external reads only when the exact host is on the user allowlist', async () => {
    const registry = registryWith()
    const allowed = new Gateway({
      registry,
      policy: testPolicy,
      audit,
      grants,
      approve: async () => true,
      externalHostAllowed: (host) => host === 'example.com'
    })
    const denied = new Gateway({
      registry,
      policy: testPolicy,
      audit,
      grants,
      approve: async () => true,
      externalHostAllowed: (host) => host === 'other.example'
    })

    const fetched = await allowed.execute(call('url_tool', {}))
    const blocked = await denied.execute(call('url_tool', {}))

    expect(fetched.ok).toBe(true)
    expect(blocked.blocked).toBe(true)
    expect(blocked.error).toContain('exact domain is not on the user allowlist')
  })

  it('times out a tool that ignores its abort signal', async () => {
    const gateway = makeGateway({ toolTimeoutMs: 30 })
    const started = Date.now()
    const result = await gateway.execute(call('hang', {}))

    expect(result.ok).toBe(false)
    expect(result.error).toContain('timed out')
    expect(Date.now() - started).toBeLessThan(1000)
    expect(audit.list().map((event) => event.type)).toContain('call.failed')
  })

  it('reports tool failures', async () => {
    const result = await makeGateway().execute(call('boom', {}))
    expect(result.ok).toBe(false)
    expect(result.error).toBe('kaboom')
  })

  it('fails closed when the audit log is unavailable', async () => {
    const run = vi.fn(async () => ({ wrote: true }))
    const registry = new ToolRegistry().register({
      name: 'echo',
      description: 'Read',
      risk: 'read',
      input: z.object({}),
      run
    })

    class FailingAudit extends AuditLog {
      override append(): Promise<AuditEvent> {
        return Promise.reject(new Error('disk full'))
      }
    }

    const result = await makeGateway({
      registry,
      log: new FailingAudit(auditDir, 'failing')
    }).execute(call('echo', {}))

    expect(result.blocked).toBe(true)
    expect(result.error).toContain('audit log is unavailable')
    expect(run).not.toHaveBeenCalled()
  })

  it('never writes raw tool arguments into the audit log', async () => {
    await makeGateway().execute(call('echo', { text: 'super-secret-value' }))
    expect(JSON.stringify(audit.list())).not.toContain('super-secret-value')
  })
})

describe('Gateway with folder grants', () => {
  it('blocks a write into a read-only grant before asking for approval', async () => {
    const folder = path.join(root, 'papers')
    await mkdir(folder)
    const grant = await grants.add({ folderPath: folder, access: 'read' })

    const run = vi.fn(async () => ({ wrote: true }))
    const registry = new ToolRegistry().register({
      name: 'write_papers',
      description: 'Write into papers',
      risk: 'write',
      input: z.object({}),
      scope: async (_args, ctx) => {
        const target = ctx.grants.get('papers')
        const resolved = await resolveGrantPath(target, 'note.md')
        return {
          kind: 'path',
          grantId: target.id,
          grantLabel: target.label,
          path: resolved.path,
          relative: resolved.relative
        }
      },
      run
    })

    const approve = vi.fn(async () => true)
    const result = await makeGateway({ registry, approve }).execute(call('write_papers', {}))

    expect(result.blocked).toBe(true)
    expect(result.error).toContain('read-only')
    expect(run).not.toHaveBeenCalled()
    expect(approve).not.toHaveBeenCalled()
    expect(grant.access).toBe('read')
  })

  it('allows reads from a read-only grant', async () => {
    const folder = path.join(root, 'papers')
    await mkdir(folder)
    await writeFile(path.join(folder, 'note.md'), 'hello', 'utf8')
    await grants.add({ folderPath: folder, access: 'read' })

    const registry = new ToolRegistry()
    for (const tool of fsTools) registry.register(tool)

    const result = await makeGateway({ registry }).execute(
      call('read_file', { root: 'papers', path: 'note.md' })
    )

    expect(result.ok).toBe(true)
    expect((result.output as { content: string }).content).toBe('hello')
  })

  it('blocks a write when the grant is revoked while the dialog is open', async () => {
    const folder = path.join(root, 'extra')
    await mkdir(folder)
    const grant = await grants.add({ folderPath: folder, access: 'read-write' })

    const run = vi.fn(async () => ({ wrote: true }))
    const registry = new ToolRegistry().register({
      name: 'write_extra',
      description: 'Write into extra',
      risk: 'write',
      input: z.object({}),
      scope: async (_args, ctx) => {
        const target = ctx.grants.get('extra')
        const resolved = await resolveGrantPath(target, 'file.txt')
        return {
          kind: 'path',
          grantId: target.id,
          grantLabel: target.label,
          path: resolved.path,
          relative: resolved.relative
        }
      },
      run
    })

    const result = await makeGateway({
      registry,
      approve: async () => {
        await grants.remove(grant.id)
        return true
      }
    }).execute(call('write_extra', {}))

    expect(result.blocked).toBe(true)
    expect(result.error).toContain('no longer approved')
    expect(run).not.toHaveBeenCalled()
  })

  it('blocks a write when the grant is downgraded while the dialog is open', async () => {
    const folder = path.join(root, 'extra')
    await mkdir(folder)
    const grant = await grants.add({ folderPath: folder, access: 'read-write' })

    const run = vi.fn(async () => ({ wrote: true }))
    const registry = new ToolRegistry().register({
      name: 'write_extra',
      description: 'Write into extra',
      risk: 'write',
      input: z.object({}),
      scope: async (_args, ctx) => {
        const target = ctx.grants.get('extra')
        const resolved = await resolveGrantPath(target, 'file.txt')
        return {
          kind: 'path',
          grantId: target.id,
          grantLabel: target.label,
          path: resolved.path,
          relative: resolved.relative
        }
      },
      run
    })

    const result = await makeGateway({
      registry,
      approve: async () => {
        await grants.setAccess(grant.id, 'read')
        return true
      }
    }).execute(call('write_extra', {}))

    expect(result.blocked).toBe(true)
    expect(result.error).toContain('read-only')
    expect(run).not.toHaveBeenCalled()
  })

  it('blocks a request for a folder that is not approved', async () => {
    const registry = new ToolRegistry()
    for (const tool of fsTools) registry.register(tool)

    const result = await makeGateway({ registry }).execute(
      call('list_dir', { root: 'ghost', path: '' })
    )

    expect(result.blocked).toBe(true)
    expect(result.error).toContain('no approved folder called "ghost"')
  })

  it('passes the validated canonical path to the tool', async () => {
    const result = await makeGateway().execute(call('scoped_read', { path: 'notes/a.txt' }))
    expect(result.ok).toBe(true)
    expect((result.output as { resolved: string }).resolved).toBe(
      path.join(root, 'notes', 'a.txt')
    )
  })
})

describe('Gateway with real filesystem tools', () => {
  function fsGateway(approve: ApprovalBroker = () => Promise.resolve(true)): Gateway {
    const registry = new ToolRegistry()
    for (const tool of fsTools) registry.register(tool)
    return makeGateway({ registry, approve })
  }

  it('writes after approval, then reads and lists the file', async () => {
    const gateway = fsGateway()

    const write = await gateway.execute(
      call('write_file', { path: 'notes/hello.md', content: 'Hello from Mike Assist' })
    )
    expect(write.ok).toBe(true)

    const read = await gateway.execute(call('read_file', { path: 'notes/hello.md' }))
    expect(read.ok).toBe(true)
    expect((read.output as { content: string }).content).toBe('Hello from Mike Assist')

    const list = await gateway.execute(call('list_dir', { path: '.' }))
    expect(list.ok).toBe(true)
    const entries = (list.output as { entries: Array<{ name: string }> }).entries
    expect(entries.map((entry) => entry.name)).toContain('notes')
  })

  it('treats an empty list path as the grant root', async () => {
    await writeFile(path.join(root, 'hello.md'), 'hi', 'utf8')

    const result = await fsGateway().execute(call('list_dir', { path: '' }))

    expect(result.ok).toBe(true)
    const output = result.output as { path: string; entries: Array<{ name: string }> }
    expect(output.path).toBe('.')
    expect(output.entries.map((entry) => entry.name)).toContain('hello.md')
  })

  it('continues large folder listings in stable sorted pages', async () => {
    await Promise.all(Array.from({ length: 501 }, (_, index) =>
      writeFile(path.join(root, `entry-${String(index).padStart(3, '0')}.txt`), 'x', 'utf8')
    ))

    const gateway = fsGateway()
    const names: string[] = []
    let startIndex = 0
    let pages = 0
    for (;;) {
      const result = await gateway.execute(call('list_dir', { path: '', startIndex }))
      expect(result.ok, result.error).toBe(true)
      const output = result.output as {
        entries: Array<{ name: string }>
        startIndex: number
        totalEntries: number
        nextIndex?: number
        truncated: boolean
      }
      expect(output.startIndex).toBe(startIndex)
      expect(output.totalEntries).toBe(501)
      expect(JSON.stringify({ ok: true, output }).length).toBeLessThan(8_000)
      names.push(...output.entries.map((entry) => entry.name))
      pages += 1
      if (!output.truncated) break
      expect(output.nextIndex).toBe(startIndex + output.entries.length)
      expect(output.nextIndex).toBeGreaterThan(startIndex)
      startIndex = output.nextIndex!
    }

    expect(pages).toBeGreaterThan(1)
    expect(names).toHaveLength(501)
    expect(names[0]).toBe('entry-000.txt')
    expect(names.at(-1)).toBe('entry-500.txt')
  })

  it('leaves the file untouched when approval is denied', async () => {
    const gateway = fsGateway(() => Promise.resolve(false))
    const result = await gateway.execute(
      call('write_file', { path: 'denied.md', content: 'should not exist' })
    )

    expect(result.denied).toBe(true)
    await expect(readFile(path.join(root, 'denied.md'), 'utf8')).rejects.toMatchObject({
      code: 'ENOENT'
    })
  })

  it('blocks a real write outside the grant', async () => {
    const result = await fsGateway().execute(
      call('write_file', { path: '../escape.md', content: 'nope' })
    )

    expect(result.blocked).toBe(true)
    expect(result.error).toContain('outside the "Workspace" folder')
  })

  it('blocks a symlink escape through a grant', async () => {
    const link = path.join(root, 'outside-link')
    try {
      await symlink(outside, link, 'junction')
    } catch {
      return
    }

    const result = await fsGateway().execute(call('read_file', { path: 'outside-link/x.txt' }))
    expect(result.blocked).toBe(true)
    expect(result.error).toContain('outside the "Workspace" folder')
  })

  it('reads an empty file without failing', async () => {
    await writeFile(path.join(root, 'empty.txt'), '', 'utf8')

    const result = await fsGateway().execute(call('read_file', { path: 'empty.txt' }))
    expect(result.ok).toBe(true)
    expect((result.output as { content: string }).content).toBe('')
  })

  it('continues bounded UTF-8 text reads without splitting characters', async () => {
    const source = `${'A'.repeat(3)}😀尾`
    await writeFile(path.join(root, 'long.txt'), source, 'utf8')

    const first = await fsGateway().execute(call('read_file', { path: 'long.txt', maxBytes: 4 }))
    expect(first.ok, first.error).toBe(true)
    const firstPage = first.output as { content: string; startByte: number; bytesRead: number; nextByte?: number; truncated: boolean }
    expect(firstPage).toMatchObject({ content: 'AAA', startByte: 0, bytesRead: 3, nextByte: 3, truncated: true })

    const second = await fsGateway().execute(call('read_file', { path: 'long.txt', startByte: firstPage.nextByte, maxBytes: 4 }))
    expect(second.ok, second.error).toBe(true)
    const secondPage = second.output as { content: string; startByte: number; bytesRead: number; nextByte?: number; truncated: boolean }
    expect(secondPage).toMatchObject({ content: '😀', startByte: 3, bytesRead: 4, nextByte: 7, truncated: true })

    const final = await fsGateway().execute(call('read_file', { path: 'long.txt', startByte: secondPage.nextByte, maxBytes: 4 }))
    expect(final.ok, final.error).toBe(true)
    const finalPage = final.output as { content: string; startByte: number; bytesRead: number; truncated: boolean }
    expect(finalPage).toMatchObject({ content: '尾', startByte: 7, bytesRead: 3, truncated: false })
    expect(firstPage.content + secondPage.content + finalPage.content).toBe(source)
  })

  it('shows current content in an overwrite preview', async () => {
    await writeFile(path.join(root, 'existing.md'), 'old content', 'utf8')

    const grant = grants.primary()
    const resolved = await resolveGrantPath(grant, 'existing.md')
    const context: ToolContext = {
      kind: 'path',
      signal: new AbortController().signal,
      path: resolved.path,
      grant,
      relative: resolved.relative
    }

    const preview = await writeFileTool.preview?.(
      { path: 'existing.md', content: 'new content' },
      context
    )

    expect(preview).toContain('Overwrite')
    expect(preview).toContain('old content')
    expect(preview).toContain('new content')
  })

  it('writes into a second approved folder by label', async () => {
    const folder = path.join(root, 'Course materials')
    await mkdir(folder)
    await grants.add({ folderPath: folder, access: 'read-write' })

    const gateway = fsGateway()
    const result = await gateway.execute(
      call('write_file', {
        root: 'Course materials',
        path: 'summary.md',
        content: 'Summary'
      })
    )

    expect(result.ok).toBe(true)
    expect(await readFile(path.join(folder, 'summary.md'), 'utf8')).toBe('Summary')
  })
})
