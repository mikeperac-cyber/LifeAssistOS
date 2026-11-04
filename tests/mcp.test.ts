import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js'
import type { CallToolResult, Tool } from '@modelcontextprotocol/sdk/types.js'
import { AuditLog } from '../src/core/audit/log'
import { resolveDecision, defaultPolicy } from '../src/core/gateway/policy'
import { ToolRegistry } from '../src/core/registry'
import { McpServerManager } from '../src/core/mcp/manager'
import { McpServerStore, isAcceptableUrl } from '../src/core/mcp/store'
import { invocationName, sanitizeSegment } from '../src/core/mcp/naming'

describe('mcp naming', () => {
  it('keeps provider-safe names under 64 characters', () => {
    const name = invocationName('demo', 'read_text')
    expect(name).toBe('mcp__demo__read_text')
    expect(name.length).toBeLessThanOrEqual(64)
    expect(name).toMatch(/^[A-Za-z0-9_-]{1,64}$/)
  })

  it('sanitizes hostile names and appends a hash when long', () => {
    expect(sanitizeSegment('my files!!')).toBe('my_files')
    const long = invocationName('x'.repeat(40), 'y'.repeat(60))
    expect(long.length).toBeLessThanOrEqual(64)
    expect(long.startsWith('mcp__x')).toBe(true)
  })

  it('never collides after truncation', () => {
    const a = invocationName('a'.repeat(40) + '1', 'tool'.repeat(20) + '1')
    const b = invocationName('a'.repeat(40) + '2', 'tool'.repeat(20) + '2')
    expect(a).not.toBe(b)
  })
})

describe('mcp store', () => {
  it('accepts https anywhere but plain http only on loopback', () => {
    expect(isAcceptableUrl('https://example.com/mcp')).toBe(true)
    expect(isAcceptableUrl('http://127.0.0.1:3000')).toBe(true)
    expect(isAcceptableUrl('http://localhost:3000')).toBe(true)
    expect(isAcceptableUrl('http://example.com')).toBe(false)
    expect(isAcceptableUrl('ftp://example.com')).toBe(false)
    expect(isAcceptableUrl('https://user:pass@example.com')).toBe(false)
  })

  it('persists and reloads records, rejecting broken input', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'mike-assist-mcp-store-'))
    const file = path.join(dir, 'mcp-servers.json')
    const store = new McpServerStore(file)
    await store.init()

    const valid = store.normalizeInput({ name: 'demo', transport: 'stdio', command: 'demo-server', args: ['--x'], enabled: true })
    expect(valid).toMatchObject({ name: 'demo', transport: 'stdio' })
    await store.add(valid!)
    await store.add(store.normalizeInput({ name: 'web', transport: 'http', url: 'https://example.com/mcp' })!)

    await expect(store.add(valid!)).rejects.toThrow(/unique/)
    expect(store.normalizeInput({ name: 'bad name!', transport: 'stdio', command: 'x' })).toBeNull()
    expect(store.normalizeInput({ name: 'ok', transport: 'stdio', command: '' })).toBeNull()
    expect(store.normalizeInput({ name: 'ok', transport: 'http', url: 'http://nope.example' })).toBeNull()
    expect(store.list()).toHaveLength(2)

    const reloaded = new McpServerStore(file)
    await reloaded.init()
    expect(reloaded.list().map((record) => record.name)).toEqual(['demo', 'web'])
    await rm(dir, { recursive: true, force: true })
  })

  it('drops unusable stored records at startup', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'mike-assist-mcp-bad-'))
    const file = path.join(dir, 'mcp-servers.json')
    await (await import('node:fs/promises')).writeFile(
      file,
      JSON.stringify({ version: 1, servers: [{ id: 'a', name: 'broken', transport: 'stdio', createdAt: '2026-01-01' }] }),
      'utf8'
    )
    const store = new McpServerStore(file)
    await store.init()
    expect(store.list()).toHaveLength(0)
    expect(JSON.parse(await readFile(file, 'utf8')).servers).toHaveLength(0)
    await rm(dir, { recursive: true, force: true })
  })

  it('drops stored records with malformed argument lists before exposing them', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'mike-assist-mcp-invalid-args-'))
    const file = path.join(dir, 'mcp-servers.json')
    await (await import('node:fs/promises')).writeFile(
      file,
      JSON.stringify({
        version: 1,
        servers: [{
          id: 'malformed-args',
          name: 'broken',
          transport: 'stdio',
          command: 'demo-server',
          args: {},
          enabled: true,
          createdAt: '2026-01-01T00:00:00.000Z'
        }]
      }),
      'utf8'
    )

    const store = new McpServerStore(file)
    await store.init()

    expect(store.list()).toHaveLength(0)
    await rm(dir, { recursive: true, force: true })
  })

  it('update keeps transports coherent (http clears command, stdio clears url)', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'mike-assist-mcp-update-'))
    const store = new McpServerStore(path.join(dir, 'mcp-servers.json'))
    await store.init()
    const record = await store.add({
      name: 'demo',
      transport: 'stdio',
      command: 'run.exe',
      args: ['--x'],
      enabled: true
    })

    const switched = await store.update(record.id, { transport: 'http', url: 'https://example.com/mcp' })
    expect(switched.command).toBeUndefined()
    expect(switched.args).toEqual([])

    await expect(store.update(record.id, { url: '' })).rejects.toThrow(/https/)
    await rm(dir, { recursive: true, force: true })
  })
})

describe('mcp gateway policy', () => {
  it('always asks for mcp tools regardless of trust claims', () => {
    expect(resolveDecision('mcp__demo__anything', 'external', defaultPolicy)).toMatchObject({ decision: 'ask' })
    expect(resolveDecision('mcp__demo__readonly_tool', 'external', defaultPolicy)).toMatchObject({ decision: 'ask' })
    expect(resolveDecision('unknown_tool', 'external', defaultPolicy).decision).toBe('block')
  })
})

describe('McpServerManager with an in-memory server', () => {
  interface Harness {
    manager: McpServerManager
    registry: ToolRegistry
    store: McpServerStore
    server: Server
    audit: AuditLog
    dir: string
    record: Awaited<ReturnType<McpServerStore['add']>>
  }

  async function makeManager(
    tools: Tool[],
    handlers?: {
      onCallTool?: (name: string, args: Record<string, unknown>, signal: AbortSignal) => Promise<CallToolResult>
    },
    limits: { connectTimeoutMs?: number; callTimeoutMs?: number } = {}
  ): Promise<Harness> {
    const dir = await mkdtemp(path.join(tmpdir(), 'mike-assist-mcp-runtime-'))
    const audit = new AuditLog(path.join(dir, 'audit'), 'mcp-test')
    await audit.init()
    const store = new McpServerStore(path.join(dir, 'mcp-servers.json'))
    await store.init()
    const record = await store.add(
      store.normalizeInput({ name: 'demo', transport: 'http', url: 'https://example.com/mcp', enabled: true })!
    )

    const registry = new ToolRegistry()
    const manager = new McpServerManager(store, {
      registry,
      audit,
      clientVersion: 'test',
      ...limits,
      transportFor: () => {
        throw new Error('transport factory plugged in per test')
      }
    })

    const createServer = (): { server: Server; clientTransport: InMemoryTransport; serverTransport: InMemoryTransport } => {
      const server = new Server({ name: 'test-server', version: '0.0.1' }, { capabilities: { tools: {} } })
      server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools }))
      server.setRequestHandler(CallToolRequestSchema, async (request, extra): Promise<CallToolResult> => {
        if (handlers?.onCallTool) {
          return handlers.onCallTool(
            request.params.name,
            (request.params.arguments ?? {}) as Record<string, unknown>,
            extra.signal
          )
        }
        return { content: [{ type: 'text', text: `echo:${request.params.name}` }] }
      })
      const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
      void server.connect(serverTransport)
      return { server, clientTransport, serverTransport }
    }

    let activeServer = createServer()
    Object.assign((manager as unknown as { options: { transportFor?: unknown } }).options, {
      transportFor: () => {
        const transport = activeServer.clientTransport
        activeServer = createServer()
        return transport
      }
    })

    await manager.queueConnect(record.id)
    return { manager, registry, store, server: activeServer.server, audit, dir, record }
  }

  it('registers found tools with untrusted ask-only policy', async () => {
    const { manager, registry, audit, dir } = await makeManager([
      {
        name: 'read_text',
        description: 'Reads a file next door',
        inputSchema: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] }
      }
    ])

    const info = manager.info()[0]
    expect(info.status).toBe('connected')
    expect(info.tools).toHaveLength(1)
    expect(info.tools[0]?.invocationName).toBe('mcp__demo__read_text')
    expect(info.tools[0]?.toolName).toBe('read_text')

    const def = registry.get('mcp__demo__read_text')
    expect(def).toBeTruthy()
    expect(def?.sessionApprovalAllowed).toBe(false)
    expect(def?.risk).toBe('external')

    const types = audit.list().map((event) => event.type)
    expect(types).toContain('mcp.tools_changed')
    expect(types).toContain('mcp.connected')

    await manager.dispose()
    expect(audit.list().map((event) => event.type)).toContain('mcp.disconnected')
    await rm(dir, { recursive: true, force: true })
  })

  it('caps at 24 tools and marks truncation', async () => {
    const tools: Tool[] = Array.from({ length: 30 }, (_value, index) => ({
      name: `tool_${String(index).padStart(2, '0')}`,
      description: 'x',
      inputSchema: { type: 'object' as const }
    }))
    const { manager, registry, dir } = await makeManager(tools)

    const info = manager.info()[0]
    expect(info.truncated).toBe(true)
    expect(info.tools).toHaveLength(24)
    expect(registry.list().filter((tool) => tool.name.startsWith('mcp__'))).toHaveLength(24)

    await manager.dispose()
    await rm(dir, { recursive: true, force: true })
  })

  it('removes tools when disabled and re-adds on enable', async () => {
    const tools: Tool[] = [
      { name: 'one', description: '', inputSchema: { type: 'object' as const } },
      { name: 'two', description: '', inputSchema: { type: 'object' as const } }
    ]
    const { manager, registry, store, dir } = await makeManager(tools)
    const record = store.list()[0]

    await store.update(record.id, { enabled: false })
    await manager.queueDisable(record.id)
    expect(registry.list().filter((tool) => tool.name.startsWith('mcp__'))).toHaveLength(0)
    expect(manager.info()[0]?.status).toBe('disabled')

    await store.update(record.id, { enabled: true })
    await manager.queueConnect(record.id)
    expect(
      registry
        .list()
        .filter((tool) => tool.name.startsWith('mcp__'))
        .map((tool) => tool.name)
        .sort()
    ).toEqual(['mcp__demo__one', 'mcp__demo__two'])
    expect(manager.info()[0]?.tools.map((tool) => tool.toolName).sort()).toEqual(['one', 'two'])

    await manager.dispose()
    await rm(dir, { recursive: true, force: true })
  })

  it('reflects a failed server as error status without freezing startup', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'mike-assist-mcp-fail-'))
    const audit = new AuditLog(path.join(dir, 'audit'), 'mcp-fail')
    await audit.init()
    const store = new McpServerStore(path.join(dir, 'mcp-servers.json'))
    await store.init()
    const record = await store.add(store.normalizeInput({ name: 'ghost', transport: 'http', url: 'https://example.com/mcp' })!)

    const registry = new ToolRegistry()
    const manager = new McpServerManager(store, {
      registry,
      audit,
      clientVersion: 'test',
      transportFor: () => {
        throw new Error('ENOENT: cannot spawn')
      }
    })

    await manager.queueConnect(record.id)
    const info = manager.info()[0]
    expect(info.status).toBe('error')
    expect(info.error).toMatch(/launch|spawn|ENOENT/i)
    expect(registry.list().some((tool) => tool.name.startsWith('mcp__'))).toBe(false)
    expect(audit.list().some((event) => event.type === 'mcp.failed')).toBe(true)

    await manager.dispose()
    await rm(dir, { recursive: true, force: true })
  })

  it('closes a transport when its connection times out', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'mike-assist-mcp-timeout-'))
    const audit = new AuditLog(path.join(dir, 'audit'), 'mcp-timeout')
    await audit.init()
    const store = new McpServerStore(path.join(dir, 'mcp-servers.json'))
    await store.init()
    const record = await store.add(store.normalizeInput({
      name: 'stalled',
      transport: 'http',
      url: 'https://example.com/mcp'
    })!)
    let closed = false
    const transport = {
      async start() { await new Promise<void>(() => undefined) },
      async send() {},
      async close() { closed = true; transport.onclose?.() },
      onclose: undefined as (() => void) | undefined
    }
    const manager = new McpServerManager(store, {
      registry: new ToolRegistry(),
      audit,
      clientVersion: 'test',
      connectTimeoutMs: 10,
      transportFor: () => transport
    })

    await manager.queueConnect(record.id)
    expect(manager.info()[0]).toMatchObject({ status: 'error' })
    expect(manager.info()[0]?.error).toContain('did not answer in time')
    expect(closed).toBe(true)

    await manager.dispose()
    await rm(dir, { recursive: true, force: true })
  })

  it('runs a tool call end to end and normalizes the result', async () => {
    const calls: Array<{ name: string; args: Record<string, unknown> }> = []
    const { manager, registry, dir } = await makeManager(
      [
        {
          name: 'greet',
          description: 'greets someone',
          inputSchema: { type: 'object', properties: { who: { type: 'string' } }, required: ['who'] }
        }
      ],
      {
        onCallTool: async (name, args) => {
          calls.push({ name, args })
          return { content: [{ type: 'text', text: `hi ${String(args.who)}` }] }
        }
      }
    )

    const def = registry.get('mcp__demo__greet')!
    // The zod refinement must reject schema violations before the call leaves.
    expect(def.input.safeParse({ who: 7 }).success).toBe(false)
    expect(def.input.safeParse({ who: 'Mike' }).success).toBe(true)

    const result = (await def.run({ who: 'Mike' }, { kind: 'none', signal: new AbortController().signal })) as {
      ok: boolean
      text: string
    }
    expect(result.ok).toBe(true)
    expect(result.text).toBe('hi Mike')
    expect(calls).toHaveLength(1)

    await manager.dispose()
    await rm(dir, { recursive: true, force: true })
  })

  it('marks error responses as not ok', async () => {
    const { manager, registry, dir } = await makeManager(
      [{ name: 'boom', description: '', inputSchema: { type: 'object' as const } }],
      { onCallTool: async () => ({ content: [{ type: 'text', text: 'went wrong' }], isError: true }) }
    )

    const def = registry.get('mcp__demo__boom')!
    const result = (await def.run({}, { kind: 'none', signal: new AbortController().signal })) as { ok: boolean; text: string }
    expect(result.ok).toBe(false)
    expect(result.text).toBe('went wrong')

    await manager.dispose()
    await rm(dir, { recursive: true, force: true })
  })

  it('cancels a server tool request when its timeout expires', async () => {
    let observeCancellation: () => void = () => undefined
    const cancellationObserved = new Promise<void>((resolve) => { observeCancellation = resolve })
    const { manager, registry, dir } = await makeManager(
      [{ name: 'slow', description: '', inputSchema: { type: 'object' as const } }],
      {
        onCallTool: async (_name, _args, signal) => new Promise<CallToolResult>((_resolve, reject) => {
          signal.addEventListener('abort', () => {
            observeCancellation()
            reject(new Error('cancelled by client'))
          }, { once: true })
        })
      },
      { callTimeoutMs: 20 }
    )

    const def = registry.get('mcp__demo__slow')!
    await expect(def.run({}, { kind: 'none', signal: new AbortController().signal })).rejects.toThrow()
    const cancelled = await Promise.race([
      cancellationObserved.then(() => true),
      new Promise<boolean>((resolve) => setTimeout(() => resolve(false), 300))
    ])
    expect(cancelled).toBe(true)

    await manager.dispose()
    await rm(dir, { recursive: true, force: true })
  })
})
