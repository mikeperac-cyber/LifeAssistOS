import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Agent } from '../src/core/agent'
import { AuditLog } from '../src/core/audit/log'
import { Gateway } from '../src/core/gateway/gateway'
import { SessionApprovalStore } from '../src/core/gateway/session-approvals'
import { defaultPolicy } from '../src/core/gateway/policy'
import { GrantStore } from '../src/core/grants'
import { MemoryStore } from '../src/core/memory'
import { ToolRegistry } from '../src/core/registry'
import type { AppSettings, AssistEvent, PermissionRequest, ToolCall } from '../src/shared/types'
import type { ChatRequest, ChatResponse, Provider } from '../src/core/providers/types'
import { createMemoryTools } from '../src/tools/memory'

let root = ''
let auditDir = ''
let audit: AuditLog
let grants: GrantStore
let memory: MemoryStore

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'mike-assist-memory-tools-'))
  auditDir = await mkdtemp(path.join(tmpdir(), 'mike-assist-memory-tools-audit-'))
  audit = new AuditLog(auditDir, 'memory-tools-test')
  await audit.init()
  grants = new GrantStore(path.join(root, 'grants.json'))
  await grants.init(root)
  memory = new MemoryStore(path.join(root, 'memory.sqlite'))
  await memory.init()
})

afterEach(async () => {
  memory.close()
  await rm(root, { recursive: true, force: true })
  await rm(auditDir, { recursive: true, force: true })
})

function memoryGateway(overrides: {
  approve?: (request: PermissionRequest) => 'once' | 'deny' | 'session'
  sessionApprovals?: SessionApprovalStore
  sessionId?: () => string
} = {}): Gateway {
  const registry = new ToolRegistry()
  for (const tool of createMemoryTools(memory)) registry.register(tool)
  return new Gateway({
    registry,
    policy: defaultPolicy,
    audit,
    grants,
    approve: (request) => Promise.resolve(overrides.approve?.(request) ?? 'deny'),
    sessionApprovals: overrides.sessionApprovals,
    sessionId: overrides.sessionId
  })
}

function saveCall(args: unknown): ToolCall {
  return { id: `call-save-${Math.random()}`, name: 'save_memory', args, summary: 'Save an approved fact to memory', risk: 'write' }
}

function recallCall(args: unknown): ToolCall {
  return { id: `call-recall-${Math.random()}`, name: 'recall_memory', args, summary: 'Search memory for matching facts', risk: 'read' }
}

function archiveCall(args: unknown): ToolCall {
  return { id: `call-archive-${Math.random()}`, name: 'archive_memory', args, summary: 'Archive a memory fact', risk: 'write' }
}

function agentSettings(): AppSettings {
  return {
    provider: {
      preset: 'ollama',
      baseUrl: 'http://127.0.0.1:11434/v1',
      model: 'fake-model',
      contextLength: 8192,
      temperature: 0,
      maxSteps: 4
    }
  }
}

type FakeResponse = ChatResponse | ((request: ChatRequest) => ChatResponse)

class FakeProvider implements Provider {
  readonly name = 'fake'
  readonly requests: ChatRequest[] = []

  constructor(private readonly responses: FakeResponse[]) {}

  async chat(request: ChatRequest): Promise<ChatResponse> {
    this.requests.push(request)
    const next = this.responses.shift()
    if (!next) throw new Error('FakeProvider ran out of responses')
    return typeof next === 'function' ? next(request) : next
  }

  async listModels(): Promise<string[]> {
    return []
  }
}

function textReply(text: string): ChatResponse {
  return { text, toolCalls: [], finishReason: 'stop' }
}

function toolReply(name: string, args: unknown): ChatResponse {
  return {
    text: '',
    toolCalls: [
      { id: `call-${Math.random()}`, type: 'function', function: { name, arguments: JSON.stringify(args) } }
    ],
    finishReason: 'tool_calls'
  }
}

describe('memory tools through the gateway', () => {
  it('saves a fact after explicit one-shot approval and audit stays content-free', async () => {
    const requests: PermissionRequest[] = []
    const gateway = memoryGateway({ approve: (request) => { requests.push(request); return 'once' } })

    const result = await gateway.execute(
      saveCall({ text: 'Mike teaches IELTS in Denizli', scope: 'teaching', sourceRef: 'chat' })
    )
    const output = result.output as { id: string; text: string; source: { kind: string } }

    expect(result.ok).toBe(true)
    expect(output.text).toBe('Mike teaches IELTS in Denizli')
    expect(output.source.kind).toBe('user')
    expect(memory.list()).toHaveLength(1)
    expect(requests).toHaveLength(1)
    expect(requests[0]?.sessionApprovalAllowed).toBe(false)
    expect(requests[0]?.tool).toBe('save_memory')

    // The audit trail records the tool call, never the fact text.
    for (const event of audit.list()) {
      expect(JSON.stringify(event)).not.toContain('Denizli')
      expect(JSON.stringify(event)).not.toContain('teaches')
    }
  })

  it('refuses a save when approval is denied', async () => {
    const gateway = memoryGateway({ approve: () => 'deny' })
    const result = await gateway.execute(saveCall({ text: 'Never saved', scope: 'general' }))

    expect(result.ok).toBe(false)
    expect(result.denied).toBe(true)
    expect(memory.list()).toHaveLength(0)
  })

  it('never reuses a session approval for save_memory', async () => {
    const approvals = new SessionApprovalStore()
    const approve = vi.fn((_request: PermissionRequest) => 'session' as const)
    const gateway = memoryGateway({
      approve: (request) => { approve(request); return 'session' },
      sessionApprovals: approvals,
      sessionId: () => 'chat-1'
    })

    const first = await gateway.execute(saveCall({ text: 'One persistent fact', scope: 'general' }))
    const second = await gateway.execute(saveCall({ text: 'A different new fact', scope: 'general' }))

    expect(first.ok).toBe(true)
    expect(second.ok).toBe(true)
    expect(approve).toHaveBeenCalledTimes(2)
  })

  it('recalls without approval', async () => {
    memory.add({ text: 'Mike lives in Denizli', scope: 'personal' })
    const gateway = memoryGateway()

    const result = await gateway.execute(recallCall({ query: 'denizli' }))
    const output = result.output as { query: string; facts: Array<{ text: string }> }

    expect(result.ok).toBe(true)
    expect(output.facts).toHaveLength(1)
    expect(output.facts[0]?.text).toBe('Mike lives in Denizli')
    expect(audit.list().some((event) => event.type === 'approval.requested')).toBe(false)
  })

  it('archives an approved fact through approval', async () => {
    const fact = memory.add({ text: 'Old project Phoenix', scope: 'business' })
    const gateway = memoryGateway({ approve: () => 'once' })

    const result = await gateway.execute(archiveCall({ id: fact.id }))
    expect(result.ok).toBe(true)
    expect(memory.list()).toHaveLength(0)
    expect(memory.list(true)[0]?.archivedAt).toBeTruthy()
    expect(memory.recall('phoenix')).toHaveLength(0)
  })

  it('rejects an invalid scope before execution', async () => {
    const gateway = memoryGateway()
    const bad: ToolCall = { id: 'x', name: 'save_memory', args: { text: 'Scoped wrong', scope: 'weird' }, summary: 'bad', risk: 'write' }
    const result = await gateway.execute(bad)
    expect(result.ok).toBe(false)
    expect(memory.list()).toHaveLength(0)
  })
})

describe('agent memory injection', () => {
  function makeAgent(provider: FakeProvider, gateway: Gateway): Agent {
    const registry = new ToolRegistry()
    for (const tool of createMemoryTools(memory)) registry.register(tool)
    return new Agent({
      gateway,
      audit,
      registry,
      grants,
      memory,
      provider: () => provider,
      settings: () => agentSettings(),
      emit: (_event: AssistEvent) => undefined
    })
  }

  it('injects matched facts into the system prompt and cites them', async () => {
    memory.add({ text: 'Mike teaches IELTS in Denizli', scope: 'teaching' })
    memory.add({ text: 'Mike prefers dark coffee', scope: 'general' })

    const provider = new FakeProvider([textReply('From [M1]: you teach IELTS in Denizli.')])
    const gateway = memoryGateway({ approve: () => 'once' })
    const agent = makeAgent(provider, gateway)

    await agent.handleUserMessage('What do you remember about Denizli?')

    const system = provider.requests[0]?.messages[0]
    expect(system?.role).toBe('system')
    expect(system?.content).toContain('[M1] (teaching) Mike teaches IELTS in Denizli')
    expect(system?.content).not.toContain('dark coffee')
    expect(
      audit.list().find((event) => event.type === 'memory.recalled')
    ).toMatchObject({ data: { facts: 1 } })
  })

  it('saves memory only through an explicit approval card', async () => {
    const requests: PermissionRequest[] = []
    const provider = new FakeProvider([
      toolReply('save_memory', { text: 'Approved fact goes in', scope: 'general' }),
      textReply('Saved.')
    ])
    const gateway = memoryGateway({
      approve: (request) => {
        requests.push(request)
        return 'once'
      }
    })
    const agent = makeAgent(provider, gateway)

    await agent.handleUserMessage('Please remember: approved fact goes in')

    expect(memory.list().map((fact) => fact.text)).toEqual(['Approved fact goes in'])
    expect(requests).toHaveLength(1)
  })

  it('writes nothing to memory when the user denies the approval', async () => {
    const provider = new FakeProvider([
      toolReply('save_memory', { text: 'Denied fact', scope: 'general' }),
      textReply('It was denied.')
    ])
    const gateway = memoryGateway({ approve: () => 'deny' })
    const agent = makeAgent(provider, gateway)

    await agent.handleUserMessage('Remember denied fact')

    expect(memory.list()).toHaveLength(0)
    // The agent stops after the denial instead of trying other tools.
    expect(provider.requests).toHaveLength(1)
    expect(audit.list().some((event) => event.type === 'approval.denied')).toBe(true)
  })
})
