import { mkdtemp, realpath, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { AuditLog } from '../src/core/audit/log'
import { Gateway } from '../src/core/gateway/gateway'
import { defaultPolicy } from '../src/core/gateway/policy'
import { GrantStore } from '../src/core/grants'
import { ToolRegistry } from '../src/core/registry'
import type { ToolContext } from '../src/shared/types'
import { executeCodeTool, type ExecuteCodeResult } from '../src/tools/code-execution'

function context(root: string, callTool: NonNullable<ToolContext['callTool']>, signal = new AbortController().signal): ToolContext {
  return {
    kind: 'path',
    path: root,
    grant: {
      id: 'code-test-grant',
      label: 'Code test',
      root,
      access: 'read-write',
      createdAt: new Date().toISOString()
    },
    relative: '.',
    signal,
    callTool
  }
}

describe('programmable code tool', () => {
  it('runs loops and routes each nested call through the provided tool bridge', async () => {
    const root = await realpath(await mkdtemp(path.join(tmpdir(), 'mike-assist-code-')))
    const calls: number[] = []
    try {
      const result = await executeCodeTool.run({
        code: 'let sum = 0; for (let i = 1; i <= 3; i++) { const r = await tools.call("get_number", { i }); sum += r.output.number; } console.log(sum);',
        enabledTools: ['get_number']
      }, context(root, async (_name, args) => {
        const i = (args as { i: number }).i
        calls.push(i)
        return { callId: String(i), ok: true, output: { number: i } }
      }))

      expect(result).toMatchObject({ exitCode: 0, stdout: '6\n', timedOut: false, cancelled: false })
      expect(result.toolCalls.map(({ name, ok }) => ({ name, ok }))).toEqual([
        { name: 'get_number', ok: true },
        { name: 'get_number', ok: true },
        { name: 'get_number', ok: true }
      ])
      expect(calls).toEqual([1, 2, 3])
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('stops a script after a nested tool is denied', async () => {
    const root = await realpath(await mkdtemp(path.join(tmpdir(), 'mike-assist-code-deny-')))
    try {
      const result = await executeCodeTool.run({
        code: 'await tools.call("danger", {}); console.log("continued");',
        enabledTools: ['danger']
      }, context(root, async () => ({ callId: 'denied', ok: false, denied: true, error: 'Denied.' })))

      expect(result.deniedTool).toBe('danger')
      expect(result.stdout).not.toContain('continued')
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('removes injected environment settings and limits a stuck script', async () => {
    const root = await realpath(await mkdtemp(path.join(tmpdir(), 'mike-assist-code-timeout-')))
    const previous = process.env.MIKE_ASSIST_API_KEY
    process.env.MIKE_ASSIST_API_KEY = 'test-code-secret-value'
    try {
      const result = await executeCodeTool.run({
        code: 'console.log(process.env.MIKE_ASSIST_API_KEY || "absent", process.env.ELECTRON_RUN_AS_NODE || "absent"); while (true) {}',
        enabledTools: [],
        timeoutMs: 1000
      }, context(root, async () => ({ callId: 'unused', ok: false })))

      expect(result.timedOut).toBe(true)
      expect(result.stdout).toContain('absent absent')
      expect(result.stdout).not.toContain('test-code-secret-value')
    } finally {
      if (previous === undefined) delete process.env.MIKE_ASSIST_API_KEY
      else process.env.MIKE_ASSIST_API_KEY = previous
      await rm(root, { recursive: true, force: true })
    }
  })

  it('requires typed one-time RUN approval and does not offer session approval', async () => {
    const root = await realpath(await mkdtemp(path.join(tmpdir(), 'mike-assist-code-gateway-')))
    const data = await mkdtemp(path.join(tmpdir(), 'mike-assist-code-audit-'))
    const audit = new AuditLog(data, 'code-gateway-test')
    await audit.init()
    const grants = new GrantStore(path.join(data, 'grants.json'))
    await grants.init(root)
    const approvals: Array<{ confirm?: { verb: string; expects: string }; sessionApprovalAllowed?: boolean }> = []
    const gateway = new Gateway({
      registry: new ToolRegistry().register(executeCodeTool),
      policy: defaultPolicy,
      audit,
      grants,
      approve: async (request) => {
        approvals.push(request)
        return 'once'
      }
    })

    try {
      const result = await gateway.execute({
        id: 'code-gateway-call',
        name: 'execute_code',
        args: { code: 'console.log("approved")', enabledTools: [] }
      }, undefined, { callTool: async () => ({ callId: 'unused', ok: false }) })

      expect(result.ok).toBe(true)
      expect((result.output as ExecuteCodeResult).stdout).toContain('approved')
      expect(approvals).toHaveLength(1)
      expect(approvals[0]).toMatchObject({
        confirm: { verb: 'run', expects: 'RUN' },
        sessionApprovalAllowed: false
      })
    } finally {
      await rm(root, { recursive: true, force: true })
      await rm(data, { recursive: true, force: true })
    }
  })
})
